/** 播放驱动负责资源引用和声部；资源查找独立于播放核心。 */
export interface AudioVoice {
    play(): void;
    pause(): void;
    stop(): void;
    setVolume(volume: number): void;
    dispose(): void;
}
export interface AudioDriver<Clip extends object> {
    /** 成功后返回本次播放专属的归还函数。 */
    retain(clip: Clip): () => void;
    createVoice(clip: Clip, loop: boolean, onEnded: () => void): AudioVoice;
}
export type AudioFinishReason = 'ended' | 'stopped' | 'expired' | 'stolen' | 'rejected' | 'failed' | 'disposed';
export type AudioPlaybackState = 'pending' | 'playing' | 'paused' | AudioFinishReason;
export interface AudioPlayback {
    readonly id: number;
    readonly state: AudioPlaybackState;
    readonly finished: Promise<AudioFinishReason>;
    stop(): void;
    pause(): void;
    resume(): void;
    setVolume(volume: number): void;
}
export interface AudioPlayOptions {
    bus?: string;
    loop?: boolean;
    volume?: number;
    priority?: number;
    /** 首次提交播放前允许等待的秒数。0 只接受当前可播放的资源；省略表示无限。 */
    maxDelay?: number;
    label?: string;
}
export interface AudioBusOptions { volume?: number; muted?: boolean; maxVoices?: number }
export interface AudioCoreOptions {
    maxVoices?: number;
    /** 默认提供 music/sfx/ui；额外键创建自定义总线，同名键覆盖默认配置。 */
    buses?: Readonly<Record<string, AudioBusOptions>>;
    locked?: boolean;
    /** 单调递增时钟，单位秒；仅用于等待期限，不承担音频播放进度。 */
    now?: () => number;
    onError?: (error: unknown, context: string) => void;
}
export interface AudioSnapshot {
    readonly disposed: boolean;
    readonly locked: boolean;
    readonly activeCount: number;
    readonly suspensionReasons: readonly string[];
    readonly buses: readonly { readonly name: string; readonly activeCount: number; readonly volume: number; readonly muted: boolean }[];
    readonly playbacks: readonly { readonly id: number; readonly label?: string; readonly scope: string;
        readonly bus: string; readonly state: AudioPlaybackState; readonly priority: number }[];
}
interface Bus { volume: number; muted: boolean; maxVoices: number }
function gain(value: number): number {
    if (!Number.isFinite(value)) throw new RangeError('音量必须是有限数值');
    return Math.max(0, Math.min(1, value));
}
function limit(value: number): number {
    if (!Number.isInteger(value) || value < 1) throw new RangeError('并发上限必须是正整数');
    return value;
}

/** 显式实例、总线和作用域的音频调度器；所有后端异常均报告并收敛对应播放句柄。 */
export class AudioCore<C extends object> {
    private readonly buses = new Map<string, Bus>();
    private readonly playbacks = new Set<Playback<C>>();
    private readonly scopes = new Set<AudioScope<C>>();
    private readonly suspensionReasons = new Set<string>();
    private readonly maxVoices: number;
    private readonly now: () => number;
    private readonly errorHandler?: (error: unknown, context: string) => void;
    private masterVolume = 1;
    private platformVolume = 1;
    private locked: boolean;
    private disposed = false;
    private serial = 0;

    constructor(private readonly driver: AudioDriver<C>, options: AudioCoreOptions = {}) {
        this.maxVoices = limit(options.maxVoices ?? 24);
        this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
        this.errorHandler = options.onError;
        this.locked = options.locked ?? false;
        const definitions = { music: {}, sfx: {}, ui: {}, ...options.buses };
        for (const name of Object.keys(definitions)) {
            const value: AudioBusOptions = definitions[name as keyof typeof definitions];
            this.buses.set(name, { volume: gain(value.volume ?? 1), muted: value.muted ?? false,
                maxVoices: limit(value.maxVoices ?? this.maxVoices) });
        }
    }
    createScope(name = 'AudioScope'): AudioScope<C> { this.assertOpen(); const scope = new AudioScope(this, name); this.scopes.add(scope); return scope; }
    setMasterVolume(volume: number): void { this.assertOpen(); const next = gain(volume); if (next === this.masterVolume) return; this.masterVolume = next; this.update(); }
    setPlatformVolume(volume: number): void { this.assertOpen(); const next = gain(volume); if (next === this.platformVolume) return; this.platformVolume = next; this.update(); }
    setBusVolume(name: string, volume: number): void { this.assertOpen(); const bus = this.bus(name), next = gain(volume); if (next === bus.volume) return; bus.volume = next; this.update(); }
    setBusMuted(name: string, muted: boolean): void { this.assertOpen(); const bus = this.bus(name); if (bus.muted === muted) return; bus.muted = muted; this.update(); }
    /** 暂停按原因集合合成，移除一个原因不会恢复其他来源要求的暂停。 */
    setSuspended(reason: string, suspended: boolean): void {
        this.assertOpen(); if (!reason) throw new Error('暂停原因不能为空');
        if (this.suspensionReasons.has(reason) === suspended) return;
        if (suspended) this.suspensionReasons.add(reason); else this.suspensionReasons.delete(reason);
        this.update();
    }
    unlock(): void { this.assertOpen(); this.locked = false; this.update(); }
    update(): void {
        if (this.disposed) return;
        for (const playback of Array.from(this.playbacks)) this.sync(playback);
    }
    snapshot(): AudioSnapshot {
        const all = Array.from(this.playbacks);
        return Object.freeze({ disposed: this.disposed, locked: this.locked, activeCount: all.length,
            suspensionReasons: Object.freeze(Array.from(this.suspensionReasons)),
            buses: Object.freeze(Array.from(this.buses, ([name, bus]) => Object.freeze({ name, volume: bus.volume,
                muted: bus.muted, activeCount: all.filter(p => p.bus === name).length }))),
            playbacks: Object.freeze(all.map(p => Object.freeze({ id: p.id, label: p.label, scope: p.scope.name,
                bus: p.bus, state: p.state, priority: p.priority }))) });
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const scope of Array.from(this.scopes)) scope.dispose();
        for (const playback of Array.from(this.playbacks)) this.finish(playback, 'disposed');
        this.suspensionReasons.clear(); this.scopes.clear();
    }
    /** @internal 作用域是所有权边界；应用通过 createScope 创建。 */
    play(scope: AudioScope<C>, clip: C, options: AudioPlayOptions): AudioPlayback {
        const playback = new Playback(this, scope, clip, options, ++this.serial);
        if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
        try {
            if (!clip || typeof clip !== 'object') throw new TypeError('播放需要已就绪的音频资源');
            this.bus(playback.bus);
            if (!Number.isFinite(playback.priority)) throw new RangeError('优先级必须是有限数值');
            if (options.maxDelay !== undefined && (!Number.isFinite(options.maxDelay) || options.maxDelay < 0)) throw new RangeError('等待期限必须为非负有限秒数');
            playback.volume = gain(options.volume ?? 1);
            playback.requestedAt = this.now();
            this.update();
            if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
            // 过期或无法立即播放的零等待请求不参与淘汰。
            if (this.isExpired(playback)) { this.finish(playback, 'expired'); return playback; }
            // 同一 Clip 的旧声部可能持有最后一份引用，先取得新请求的引用。
            playback.releaseClip = this.driver.retain(clip);
            if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
            if (this.isExpired(playback)) { this.finish(playback, 'expired'); return playback; }
            // 先预留席位，淘汰回调同步重入 play 时仍能看到当前请求。
            this.playbacks.add(playback); scope.track(playback);
            if (!this.admit(playback)) { this.finish(playback, 'rejected'); return playback; }
            if (playback.done) return playback;
            if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
            playback.admitted = true;
            this.sync(playback);
        } catch (error) { this.report(error, 'play:' + playback.id); this.finish(playback, 'failed'); }
        return playback;
    }
    /** @internal */
    scopeDisposed(scope: AudioScope<C>): void { this.scopes.delete(scope); }
    /** @internal */
    sync(playback: Playback<C>, passes = 0): void {
        if (playback.done) return;
        if (!playback.admitted) return; // 预留席位只参与配额，淘汰流程完成前不可启动。
        if (playback.syncing) { playback.resync = true; return; }
        if (this.disposed || playback.scope.isDisposed) { this.finish(playback, 'disposed'); return; }
        if (passes > 8) { this.report(new Error('驱动回调反复改变播放意图'), 'reentrant:' + playback.id); this.finish(playback, 'failed'); return; }
        playback.syncing = true;
        try {
            if (this.isExpired(playback)) {
                this.finish(playback, 'expired'); return;
            }
            if (!playback.voice && this.isPaused(playback)) { playback.state = 'pending'; return; }
            if (!playback.voice) {
                playback.voice = this.driver.createVoice(playback.clip!, playback.loop, () => this.finish(playback, 'ended'));
                if (playback.done) return;
            }
            const bus = this.bus(playback.bus);
            const volume = (bus.muted || playback.scope.isMuted) ? 0 :
                this.masterVolume * this.platformVolume * bus.volume * playback.scope.volume * playback.volume;
            if (playback.appliedVolume !== volume) { playback.voice.setVolume(volume); playback.appliedVolume = volume; }
            if (playback.done) return;
            if (playback.resync) return; // 先应用重入回调的最新意图，再提交首次播放。
            if (this.isPaused(playback)) {
                if (playback.state === 'playing') { playback.state = 'paused'; playback.voice.pause(); }
            } else if (playback.state !== 'playing') {
                playback.started = true; playback.state = 'playing'; playback.voice.play();
            }
        } catch (error) { this.report(error, 'voice:' + playback.id); this.finish(playback, 'failed'); }
        finally {
            playback.syncing = false;
            if (playback.done) this.cleanupPlayback(playback);
            else if (playback.resync) { playback.resync = false; this.sync(playback, passes + 1); }
        }
    }
    /** @internal 先撤销意图，再调用可能重入 onEnded 的后端。 */
    finish(playback: Playback<C>, reason: AudioFinishReason): void {
        if (playback.done) return;
        playback.done = true; playback.state = reason;
        this.playbacks.delete(playback); playback.scope.untrack(playback);
        // 驱动可能在 createVoice/play 等调用内同步结束。先等该调用返回，再清理它返回的声部。
        if (!playback.syncing) this.cleanupPlayback(playback);
    }
    private cleanupPlayback(playback: Playback<C>): void {
        const voice = playback.voice; playback.voice = undefined;
        if (voice) this.closeVoice(voice, 'finish:' + playback.id);
        const release = playback.releaseClip; playback.releaseClip = undefined;
        playback.clip = undefined;
        try { release?.(); } catch (error) { this.report(error, 'release:' + playback.id); }
        playback.complete();
    }
    private admit(incoming: Playback<C>): boolean {
        const bus = this.bus(incoming.bus);
        const all = Array.from(this.playbacks).filter(p => p !== incoming);
        const group = all.filter(p => p.bus === incoming.bus);
        const candidates = group.length >= bus.maxVoices ? group : all.length >= this.maxVoices ? all : [];
        if (!candidates.length) return true;
        candidates.sort((a, b) => a.priority - b.priority || a.id - b.id);
        const victim = candidates[0];
        if (victim.priority > incoming.priority) return false;
        this.finish(victim, 'stolen'); return true;
    }
    private closeVoice(voice: AudioVoice, context: string): void {
        try { voice.stop(); } catch (error) { this.report(error, context + ':stop'); }
        try { voice.dispose(); } catch (error) { this.report(error, context + ':dispose'); }
    }
    private report(error: unknown, context: string): void {
        try { if (this.errorHandler) this.errorHandler(error, context); else console.error('[AudioCore] ' + context, error); }
        catch { /* 错误报告器不能破坏资源释放和句柄完成。 */ }
    }
    private isPaused(playback: Playback<C>): boolean {
        return this.locked || this.suspensionReasons.size > 0 || playback.scope.isPaused || playback.paused;
    }
    private isExpired(playback: Playback<C>): boolean {
        if (playback.started || playback.maxDelay === undefined) return false;
        if (playback.maxDelay === 0) return this.isPaused(playback);
        return this.now() - playback.requestedAt >= playback.maxDelay;
    }
    private bus(name: string): Bus { const bus = this.buses.get(name); if (!bus) throw new Error('未配置音频总线：' + name); return bus; }
    private assertOpen(): void { if (this.disposed) throw new Error('音频管理器已释放'); }
}

/** 场景、玩法或窗口的独立所有权集合。同资源在不同作用域里不会共享音源。 */
export class AudioScope<C extends object> {
    private readonly playbacks = new Set<Playback<C>>();
    private disposed = false;
    private muted = false;
    private paused = false;
    private gain = 1;
    /** 应由 AudioCore.createScope 创建。 */
    constructor(private readonly core: AudioCore<C>, readonly name = 'AudioScope') {}
    get isDisposed(): boolean { return this.disposed; }
    get isMuted(): boolean { return this.muted; }
    get isPaused(): boolean { return this.paused; }
    get volume(): number { return this.gain; }
    play(clip: C, options: AudioPlayOptions = {}): AudioPlayback { return this.core.play(this, clip, options); }
    stopAll(): void { for (const playback of Array.from(this.playbacks)) playback.stop(); }
    setVolume(volume: number): void { if (this.disposed) return; const next = gain(volume); if (next === this.gain) return; this.gain = next; this.refresh(); }
    setMuted(muted: boolean): void { if (this.disposed || this.muted === muted) return; this.muted = muted; this.refresh(); }
    setPaused(paused: boolean): void { if (this.disposed || this.paused === paused) return; this.paused = paused; this.refresh(); }
    dispose(): void {
        if (this.disposed) return; this.disposed = true;
        for (const playback of Array.from(this.playbacks)) this.core.finish(playback, 'disposed');
        this.core.scopeDisposed(this);
    }
    /** @internal */ track(playback: Playback<C>): void { this.playbacks.add(playback); }
    /** @internal */ untrack(playback: Playback<C>): void { this.playbacks.delete(playback); }
    private refresh(): void { for (const playback of Array.from(this.playbacks)) this.core.sync(playback); }
}
class Playback<C extends object> implements AudioPlayback {
    state: AudioPlaybackState = 'pending';
    readonly finished: Promise<AudioFinishReason>;
    readonly bus: string;
    readonly loop: boolean;
    readonly priority: number;
    readonly maxDelay?: number;
    readonly label?: string;
    requestedAt = 0;
    volume = 1;
    paused = false;
    started = false;
    done = false;
    admitted = false;
    syncing = false;
    resync = false;
    voice?: AudioVoice;
    releaseClip?: () => void;
    appliedVolume?: number;
    private resolveFinished?: (reason: AudioFinishReason) => void;
    constructor(private readonly core: AudioCore<C>, readonly scope: AudioScope<C>, public clip: C | undefined,
        options: AudioPlayOptions, readonly id: number) {
        this.bus = options.bus ?? 'sfx'; this.loop = options.loop ?? false; this.priority = options.priority ?? 0; this.maxDelay = options.maxDelay;
        this.label = options.label;
        this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    }
    stop(): void { this.core.finish(this, 'stopped'); }
    pause(): void { if (!this.done) { this.paused = true; this.core.sync(this); } }
    resume(): void { if (!this.done) { this.paused = false; this.core.sync(this); } }
    setVolume(volume: number): void { if (!this.done) { this.volume = gain(volume); this.core.sync(this); } }
    complete(): void {
        const resolve = this.resolveFinished;
        this.resolveFinished = undefined;
        resolve?.(this.state as AudioFinishReason);
    }
}
