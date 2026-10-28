/** 引擎适配器拥有具体资源和音源；核心不依赖 cc、DOM 或平台 SDK。 */
export interface AudioVoiceBackend {
    play(): void;
    pause(): void;
    stop(): void;
    setVolume(volume: number): void;
    dispose(): void;
}
export interface AudioBackend<C> {
    /** 每次成功 load 交付一份资源所有权，核心最终对应调用一次 release。 */
    load(key: string): Promise<C>;
    release(clip: C): void;
    /** 一个播放请求独占一个音源；loop 与结束回调不得在不同音源间共享。 */
    createVoice(clip: C, onEnded: () => void, loop: boolean): AudioVoiceBackend;
}
export type AudioFinishReason = 'ended' | 'stopped' | 'expired' | 'stolen' | 'rejected' | 'failed' | 'disposed';
export type AudioPlaybackState = 'pending' | 'playing' | 'paused' | AudioFinishReason;
export interface AudioPlayback {
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
    /** 首次向后端提交播放前允许等待的秒数。0 只接受已缓存且当前可播放的资源；省略表示无限。 */
    maxDelay?: number;
}
export interface AudioBusOptions { volume?: number; muted?: boolean; maxVoices?: number }
export interface AudioManagerOptions {
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
    readonly cacheCount: number;
    readonly suspensionReasons: readonly string[];
    readonly buses: readonly { readonly name: string; readonly activeCount: number; readonly volume: number; readonly muted: boolean }[];
    readonly playbacks: readonly { readonly key: string; readonly bus: string; readonly state: AudioPlaybackState; readonly priority: number }[];
}
interface CacheEntry<C> {
    key: string;
    promise: Promise<C>;
    clip?: C;
    loaded: boolean;
    users: number;
    evict: boolean;
    released: boolean;
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
export class AudioManager<C> {
    private readonly buses = new Map<string, Bus>();
    private readonly cache = new Map<string, CacheEntry<C>>();
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

    constructor(private readonly backend: AudioBackend<C>, options: AudioManagerOptions = {}) {
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
    preload(key: string): Promise<void> {
        try { this.assertOpen(); this.checkKey(key); return this.load(key).promise.then(() => { this.assertOpen(); }); }
        catch (error) { return Promise.reject(error); }
    }
    /** 活跃音源继续持有资源，最后一个请求完成后释放；无使用者时立即逐出缓存。 */
    unload(key: string): void {
        const entry = this.cache.get(key);
        if (!entry) return;
        entry.evict = true; this.releaseIfUnused(entry);
    }
    update(): void {
        if (this.disposed) return;
        for (const playback of Array.from(this.playbacks)) this.sync(playback);
    }
    snapshot(): AudioSnapshot {
        const all = Array.from(this.playbacks);
        return Object.freeze({ disposed: this.disposed, locked: this.locked, activeCount: all.length, cacheCount: this.cache.size,
            suspensionReasons: Object.freeze(Array.from(this.suspensionReasons)),
            buses: Object.freeze(Array.from(this.buses, ([name, bus]) => Object.freeze({ name, volume: bus.volume,
                muted: bus.muted, activeCount: all.filter(p => p.bus === name).length }))),
            playbacks: Object.freeze(all.map(p => Object.freeze({ key: p.key, bus: p.bus, state: p.state, priority: p.priority }))) });
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const scope of Array.from(this.scopes)) scope.dispose();
        for (const playback of Array.from(this.playbacks)) this.finish(playback, 'disposed');
        for (const entry of Array.from(this.cache.values())) { entry.evict = true; this.releaseIfUnused(entry); }
        this.suspensionReasons.clear(); this.scopes.clear();
    }
    /** @internal 作用域是所有权边界；应用通过 createScope 创建。 */
    play(scope: AudioScope<C>, key: string, options: AudioPlayOptions): AudioPlayback {
        const playback = new Playback(this, scope, key, options, ++this.serial);
        if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
        try {
            this.checkKey(key); this.bus(playback.bus);
            if (!Number.isFinite(playback.priority)) throw new RangeError('优先级必须是有限数值');
            if (options.maxDelay !== undefined && (!Number.isFinite(options.maxDelay) || options.maxDelay < 0)) throw new RangeError('等待期限必须为非负有限秒数');
            playback.volume = gain(options.volume ?? 1);
            playback.requestedAt = this.now();
            this.update();
            if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
            // 过期或无法立即播放的零等待请求不参与淘汰，也不启动资源加载。
            if (this.isExpired(playback)) { this.finish(playback, 'expired'); return playback; }
            // 先持有已有资源，避免淘汰最后一个旧使用者时卸载新请求将立即使用的资源。
            const cached = this.cache.get(key);
            if (cached) { cached.users++; playback.entry = cached; }
            // 先预留席位，淘汰回调同步重入 play 时仍能看到当前请求。
            this.playbacks.add(playback); scope.track(playback);
            if (!this.admit(playback)) { this.finish(playback, 'rejected'); return playback; }
            if (playback.done) return playback;
            if (this.disposed || scope.isDisposed) { this.finish(playback, 'disposed'); return playback; }
            playback.admitted = true;
            const entry = playback.entry ?? this.load(key);
            if (!playback.entry) { entry.users++; playback.entry = entry; }
            entry.promise.then(() => this.sync(playback), () => this.finish(playback, 'failed'));
            this.sync(playback);
        } catch (error) { this.report(error, 'play:' + key); this.finish(playback, 'failed'); }
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
        if (passes > 8) { this.report(new Error('后端回调反复改变播放意图'), 'reentrant:' + playback.key); this.finish(playback, 'failed'); return; }
        playback.syncing = true;
        try {
            if (this.isExpired(playback)) {
                this.finish(playback, 'expired'); return;
            }
            if (!playback.entry?.loaded) { playback.state = 'pending'; return; }
            if (!playback.voice && this.isPaused(playback)) { playback.state = 'pending'; return; }
            if (!playback.voice) {
                const entry = playback.entry;
                // 创建回调可以同步重入结束/释放；临时持有资源直到迟到音源完成清理。
                entry.users++;
                try {
                    const voice = this.backend.createVoice(entry.clip as C, () => this.finish(playback, 'ended'), playback.loop);
                    if (playback.done) { this.closeVoice(voice, 'create-completed:' + playback.key); return; }
                    playback.voice = voice;
                } finally { entry.users--; this.releaseIfUnused(entry); }
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
        } catch (error) { this.report(error, 'voice:' + playback.key); this.finish(playback, 'failed'); }
        finally {
            playback.syncing = false;
            if (playback.resync) { playback.resync = false; this.sync(playback, passes + 1); }
        }
    }
    /** @internal 先撤销意图，再调用可能重入 onEnded 的后端。 */
    finish(playback: Playback<C>, reason: AudioFinishReason): void {
        if (playback.done) return;
        playback.done = true; playback.state = reason;
        this.playbacks.delete(playback); playback.scope.untrack(playback);
        const voice = playback.voice; playback.voice = undefined;
        if (voice) this.closeVoice(voice, 'finish:' + playback.key);
        const entry = playback.entry; playback.entry = undefined;
        if (entry) { entry.users--; this.releaseIfUnused(entry); }
        playback.complete(reason);
    }
    private admit(incoming: Playback<C>): boolean {
        const bus = this.bus(incoming.bus);
        const all = Array.from(this.playbacks).filter(p => p !== incoming);
        const group = all.filter(p => p.bus === incoming.bus);
        const candidates = group.length >= bus.maxVoices ? group : all.length >= this.maxVoices ? all : [];
        if (!candidates.length) return true;
        candidates.sort((a, b) => a.priority - b.priority || a.serial - b.serial);
        const victim = candidates[0];
        if (victim.priority > incoming.priority) return false;
        this.finish(victim, 'stolen'); return true;
    }
    private load(key: string): CacheEntry<C> {
        const cached = this.cache.get(key); if (cached) return cached;
        const entry: CacheEntry<C> = { key, promise: undefined!, loaded: false, users: 0, evict: false, released: false };
        this.cache.set(key, entry);
        entry.promise = Promise.resolve().then(() => this.backend.load(key)).then(clip => {
            if (clip === undefined || clip === null) throw new Error('音频后端返回空资源：' + key);
            entry.clip = clip; entry.loaded = true;
            if (this.disposed) entry.evict = true;
            this.releaseIfUnused(entry);
            return clip;
        }).catch(error => {
            if (this.cache.get(key) === entry) this.cache.delete(key);
            this.report(error, 'load:' + key); throw error;
        });
        entry.promise.catch(() => undefined);
        return entry;
    }
    private releaseIfUnused(entry: CacheEntry<C>): void {
        if (!entry.evict || entry.users !== 0) return;
        if (this.cache.get(entry.key) === entry) this.cache.delete(entry.key);
        if (entry.loaded && !entry.released) {
            entry.released = true;
            const clip = entry.clip as C; entry.clip = undefined;
            try { this.backend.release(clip); } catch (error) { this.report(error, 'release:' + entry.key); }
        }
    }
    private closeVoice(voice: AudioVoiceBackend, context: string): void {
        try { voice.stop(); } catch (error) { this.report(error, context + ':stop'); }
        try { voice.dispose(); } catch (error) { this.report(error, context + ':dispose'); }
    }
    private report(error: unknown, context: string): void {
        try { if (this.errorHandler) this.errorHandler(error, context); else console.error('[AudioManager] ' + context, error); }
        catch { /* 错误报告器不能破坏资源释放和句柄完成。 */ }
    }
    private isPaused(playback: Playback<C>): boolean {
        return this.locked || this.suspensionReasons.size > 0 || playback.scope.isPaused || playback.paused;
    }
    private isExpired(playback: Playback<C>): boolean {
        if (playback.started || playback.maxDelay === undefined) return false;
        if (playback.maxDelay === 0) return !(playback.entry ?? this.cache.get(playback.key))?.loaded || this.isPaused(playback);
        return this.now() - playback.requestedAt >= playback.maxDelay;
    }
    private bus(name: string): Bus { const bus = this.buses.get(name); if (!bus) throw new Error('未配置音频总线：' + name); return bus; }
    private checkKey(key: string): void { if (typeof key !== 'string' || !key.trim()) throw new Error('音频资源键不能为空'); }
    private assertOpen(): void { if (this.disposed) throw new Error('音频管理器已释放'); }
}

/** 场景、玩法或窗口的独立所有权集合。同资源在不同作用域里不会共享音源。 */
export class AudioScope<C> {
    private readonly playbacks = new Set<Playback<C>>();
    private disposed = false;
    private muted = false;
    private paused = false;
    private gain = 1;
    /** 应由 AudioManager.createScope 创建。 */
    constructor(private readonly manager: AudioManager<C>, readonly name = 'AudioScope') {}
    get isDisposed(): boolean { return this.disposed; }
    get isMuted(): boolean { return this.muted; }
    get isPaused(): boolean { return this.paused; }
    get volume(): number { return this.gain; }
    play(key: string, options: AudioPlayOptions = {}): AudioPlayback { return this.manager.play(this, key, options); }
    stopAll(): void { for (const playback of Array.from(this.playbacks)) playback.stop(); }
    setVolume(volume: number): void { if (this.disposed) return; const next = gain(volume); if (next === this.gain) return; this.gain = next; this.refresh(); }
    setMuted(muted: boolean): void { if (this.disposed || this.muted === muted) return; this.muted = muted; this.refresh(); }
    setPaused(paused: boolean): void { if (this.disposed || this.paused === paused) return; this.paused = paused; this.refresh(); }
    dispose(): void {
        if (this.disposed) return; this.disposed = true;
        for (const playback of Array.from(this.playbacks)) this.manager.finish(playback, 'disposed');
        this.manager.scopeDisposed(this);
    }
    /** @internal */ track(playback: Playback<C>): void { this.playbacks.add(playback); }
    /** @internal */ untrack(playback: Playback<C>): void { this.playbacks.delete(playback); }
    private refresh(): void { for (const playback of Array.from(this.playbacks)) this.manager.sync(playback); }
}
class Playback<C> implements AudioPlayback {
    state: AudioPlaybackState = 'pending';
    readonly finished: Promise<AudioFinishReason>;
    readonly bus: string;
    readonly loop: boolean;
    readonly priority: number;
    readonly maxDelay?: number;
    requestedAt = 0;
    volume = 1;
    paused = false;
    started = false;
    done = false;
    admitted = false;
    syncing = false;
    resync = false;
    voice?: AudioVoiceBackend;
    entry?: CacheEntry<C>;
    appliedVolume?: number;
    private resolveFinished?: (reason: AudioFinishReason) => void;
    constructor(private readonly manager: AudioManager<C>, readonly scope: AudioScope<C>, readonly key: string,
        options: AudioPlayOptions, readonly serial: number) {
        this.bus = options.bus ?? 'sfx'; this.loop = options.loop ?? false; this.priority = options.priority ?? 0; this.maxDelay = options.maxDelay;
        this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    }
    stop(): void { this.manager.finish(this, 'stopped'); }
    pause(): void { if (!this.done) { this.paused = true; this.manager.sync(this); } }
    resume(): void { if (!this.done) { this.paused = false; this.manager.sync(this); } }
    setVolume(volume: number): void { if (!this.done) { this.volume = gain(volume); this.manager.sync(this); } }
    complete(reason: AudioFinishReason): void { const resolve = this.resolveFinished; this.resolveFinished = undefined; resolve?.(reason); }
}
