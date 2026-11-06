import { assetManager, AudioClip, AudioSource, Director, director, Game, game, Input, input, isValid, Node } from 'cc';
import { AudioBackend, AudioManager, AudioManagerOptions, AudioVoiceBackend } from './AudioManager';

/** AudioSource 在 player 安装并同步状态后发出的内部事件，此时排队的 play 已执行。 */
const PLAYER_LOADED = 'audiosource-loaded';
interface GainParam { value: number; cancelScheduledValues(time: number): unknown; setValueAtTime(value: number, time: number): unknown }
interface GainLike { gain: GainParam; context?: { currentTime: number } }
function isGain(value: unknown): value is GainLike {
    const param = (value as { gain?: Partial<GainParam> } | null)?.gain;
    return !!param && typeof param.setValueAtTime === 'function' && typeof param.cancelScheduledValues === 'function';
}
/**
 * 引擎 AudioSource/AudioPlayer 都把音量限制在 0..1；WebAudio player 内部的 GainNode 没有上限。
 * 私有字段在构建中会改名，只从受保护的 `_player` 起按形状向下查两层，找不到就返回 null。
 */
export function findAudioGain(source: AudioSource): GainLike | null {
    let level: unknown[] = [(source as unknown as { _player?: unknown })._player];
    for (let depth = 0; depth < 3; depth++) {
        const next: unknown[] = [];
        for (const value of level) {
            if (!value || typeof value !== 'object') continue;
            if (isGain(value)) return value;
            if (depth < 2) for (const key of Object.keys(value)) next.push((value as Record<string, unknown>)[key]);
        }
        level = next;
    }
    return null;
}
let warnedNoGain = false;

/** Cocos 的资源适配。key 是 resources 内的完整路径，不隐含 audio/ 前缀。 */
export class CocosAudioBackend implements AudioBackend<AudioClip> {
    constructor(private readonly root: Node) {}

    load(key: string): Promise<AudioClip> {
        return new Promise((resolve, reject) => {
            const resources = assetManager.getBundle('resources');
            if (!resources) { reject(new Error('resources bundle is unavailable')); return; }
            resources.load(key, AudioClip, (error, clip) => {
                if (error || !clip || !isValid(clip)) {
                    reject(error || new Error('Invalid audio clip: ' + key)); return;
                }
                // 只持有自己的缓存租约；其他管理器或场景可以同时引用同一资源。
                clip.addRef();
                resolve(clip);
            });
        });
    }

    release(clip: AudioClip): void { clip.decRef(); }

    createVoice(clip: AudioClip, onEnded: () => void, loop: boolean): AudioVoiceBackend {
        if (!isValid(this.root, true)) throw new Error('Audio root has been destroyed');
        // 每次播放独占节点，避免异步 player 的旧 STARTED/ENDED 污染复用后的声部。
        const node = new Node('AudioVoice');
        let source: AudioSource;
        try {
            source = node.addComponent(AudioSource);
            source.playOnAwake = false;
            source.loop = loop;
            source.volume = 0;
            source.clip = clip;
            this.root.addChild(node);
        } catch (error) { node.destroy(); throw error; }
        let disposed = false;
        let requested = false;
        let volume = 0;
        const ended = (sender: AudioSource): void => {
            if (!disposed && sender === source) onEnded();
        };
        // 超过 1 的部分写入 WebAudio 增益节点；引擎每次设置音量或安装 player 都会覆盖它，因此在这些时机之后重新写入。
        const apply = (): void => {
            const value = requested ? volume : 0;
            source.volume = Math.min(1, value);
            if (value <= 1) return;
            const gainNode = findAudioGain(source);
            if (!gainNode) {
                if (!warnedNoGain && (source as unknown as { _player?: unknown })._player) {
                    warnedNoGain = true;
                    console.warn('[CocosAudioBackend] 当前音频后端不支持超过 1 的增益，按 1 播放');
                }
                return;
            }
            const time = gainNode.context?.currentTime ?? 0;
            gainNode.gain.cancelScheduledValues(time);
            gainNode.gain.setValueAtTime(value, time);
        };
        const refresh = (): void => { if (!disposed && requested && volume > 1) apply(); };
        node.on(AudioSource.EventType.ENDED, ended);
        node.on(AudioSource.EventType.STARTED, refresh);
        node.on(PLAYER_LOADED, refresh);
        return {
            play: () => {
                if (disposed || requested) return;
                if (!isValid(source, true)) throw new Error('Audio source has been destroyed');
                requested = true;
                apply();
                // Cocos 会将未就绪 player 的播放排队，不能依据 playing 每帧重试。
                source.play();
            },
            pause: () => {
                if (disposed || !requested) return;
                requested = false;
                source.volume = 0;
                source.pause();
            },
            stop: () => {
                if (disposed) return;
                requested = false;
                source.volume = 0;
                source.stop();
                // 同步取消异步 player 安装；仅 stop() 会把命令排入加载队列。
                source.clip = null;
            },
            setVolume: value => {
                volume = value;
                if (!disposed) apply();
            },
            dispose: () => {
                if (disposed) return;
                disposed = true;
                node.off(AudioSource.EventType.ENDED, ended);
                node.off(AudioSource.EventType.STARTED, refresh);
                node.off(PLAYER_LOADED, refresh);
                source.volume = 0;
                source.stop();
                source.clip = null;
                if (isValid(node, true)) node.destroy();
            },
        };
    }
}

/**
 * Cocos 应用边界：帧更新、后台暂停、输入解锁和根节点寿命。
 * 不读取 SDK、localStorage 或玩法配置；宿主负责 dispose，也可注入其他 backend。
 */
export class CocosAudioRuntime {
    readonly manager: AudioManager<AudioClip>;
    private disposed = false;
    private listeningForInput = true;
    private readonly cleanups: Array<() => void> = [];
    get isDisposed(): boolean { return this.disposed; }

    constructor(private readonly root: Node, options: AudioManagerOptions = {}, backend: AudioBackend<AudioClip> = new CocosAudioBackend(root)) {
        if (!isValid(root, true)) throw new Error('Audio runtime requires a valid root node');
        this.manager = new AudioManager(backend, { locked: true, ...options });
        game.on(Game.EVENT_HIDE, this.onHide, this);
        game.on(Game.EVENT_SHOW, this.onShow, this);
        director.on(Director.EVENT_AFTER_UPDATE, this.update, this);
        root.on(Node.EventType.NODE_DESTROYED, this.dispose, this);
        root.on(Node.EventType.ACTIVE_IN_HIERARCHY_CHANGED, this.update, this);
        input.on(Input.EventType.TOUCH_END, this.unlock, this);
        input.on(Input.EventType.MOUSE_UP, this.unlock, this);
        input.on(Input.EventType.KEY_UP, this.unlock, this);
        this.update();
    }

    /** 在宿主确认真实交互时也可显式调用；重复调用安全。浏览器设备解锁仍由 Cocos 负责。 */
    unlock(): void {
        if (this.disposed) return;
        this.manager.unlock();
        this.removeInputListeners();
    }

    /** 宿主将外部桥接的解绑加入运行时寿命，根节点被单独销毁时也会执行。 */
    addCleanup(cleanup: () => void): void {
        if (this.disposed) cleanup(); else this.cleanups.push(cleanup);
    }

    private onHide(): void { this.manager.setSuspended('cocos:hidden', true); }
    private onShow(): void { this.manager.setSuspended('cocos:hidden', false); }
    private update(): void {
        if (this.disposed) return;
        if (!isValid(this.root, true)) { this.dispose(); return; }
        this.manager.setSuspended('cocos:inactive', !this.root.activeInHierarchy);
        this.manager.update();
    }
    private removeInputListeners(): void {
        if (!this.listeningForInput) return;
        this.listeningForInput = false;
        input.off(Input.EventType.TOUCH_END, this.unlock, this);
        input.off(Input.EventType.MOUSE_UP, this.unlock, this);
        input.off(Input.EventType.KEY_UP, this.unlock, this);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.removeInputListeners();
        game.off(Game.EVENT_HIDE, this.onHide, this);
        game.off(Game.EVENT_SHOW, this.onShow, this);
        director.off(Director.EVENT_AFTER_UPDATE, this.update, this);
        this.root.off(Node.EventType.NODE_DESTROYED, this.dispose, this);
        this.root.off(Node.EventType.ACTIVE_IN_HIERARCHY_CHANGED, this.update, this);
        for (const cleanup of this.cleanups.splice(0).reverse()) {
            try { cleanup(); } catch (error) { console.warn('[CocosAudioRuntime] Cleanup failed', error); }
        }
        this.manager.dispose();
    }
}
