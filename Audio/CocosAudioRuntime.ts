import { Director, director, Game, game, Input, input, isValid, Node } from 'cc';
import type { AudioClip } from 'cc';
import { AudioCore } from './AudioCore';
import type { AudioCoreOptions, AudioDriver } from './AudioCore';
import { CocosAudioDriver } from './CocosAudioDriver';

/**
 * Cocos 应用边界：帧更新、后台暂停、输入解锁和根节点寿命。
 * 不读取 SDK、localStorage 或玩法配置；宿主负责 dispose，也可注入其他播放驱动。
 */
export class CocosAudioRuntime {
    readonly core: AudioCore<AudioClip>;
    private disposed = false;
    private listeningForInput = true;
    private readonly cleanups: Array<() => void> = [];
    get isDisposed(): boolean { return this.disposed; }

    constructor(private readonly root: Node, options: AudioCoreOptions = {}, driver: AudioDriver<AudioClip> = new CocosAudioDriver(root)) {
        if (!isValid(root, true)) throw new Error('Audio runtime requires a valid root node');
        this.core = new AudioCore(driver, { locked: true, ...options });
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
        this.core.unlock();
        this.removeInputListeners();
    }

    /** 宿主将外部桥接的解绑加入运行时寿命，根节点被单独销毁时也会执行。 */
    addCleanup(cleanup: () => void): void {
        if (this.disposed) cleanup(); else this.cleanups.push(cleanup);
    }

    private onHide(): void { this.core.setSuspended('cocos:hidden', true); }
    private onShow(): void { this.core.setSuspended('cocos:hidden', false); }
    private update(): void {
        if (this.disposed) return;
        if (!isValid(this.root, true)) { this.dispose(); return; }
        this.core.setSuspended('cocos:inactive', !this.root.activeInHierarchy);
        this.core.update();
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
        this.core.dispose();
    }
}
