import { _decorator, AudioClip, Component, Input, input, ResolutionPolicy, screen, view } from 'cc';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
import { AudioManager } from '../Other/AudioManager';
import { CocosAudioRuntime } from '../Other/CocosAudioRuntime';
import { PlayableSDK } from '../SDK/PlayableSDK';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';

const { ccclass, disallowMultiple, property } = _decorator;

export interface IPausable {
    pause(value: boolean): void;
}


@ccclass('GameManager')
@disallowMultiple(true)
export class GameManager extends ComponentSingletonBase {

    private _isPaused: boolean = false;

    private _pausableObjectArr: IPausable[] = [];

    private _gameEndEvent: MulticastDelegate<() => void> = new MulticastDelegate<() => void>();

    public get gameEndEvent(): MulticastDelegate<() => void> {
        return this._gameEndEvent;
    }

    public get isPaused(): boolean {
        return this._isPaused;
    }

    /** 通用入口只装配音频，不再隐式播放名为 bgm 的资源。 */
    @property({ tooltip: '可选背景音乐：resources 内完整路径；留空由玩法管理音乐' })
    backgroundMusic = '';
    private audioRuntime: CocosAudioRuntime | null = null;
    private unbindPlatformAudio: (() => void) | null = null;
    /** 业务通过依赖注入共享此实例，各自创建作用域。 */
    get audio(): AudioManager<AudioClip> | null {
        return this.audioRuntime && !this.audioRuntime.isDisposed ? this.audioRuntime.manager : null;
    }

    protected onLoad(): void {
        PlayableSDK.adapter();
        PlayableSDK.gameReady();
        this.audioRuntime = new CocosAudioRuntime(this.node, {
            onError: (error, context) => console.warn('[GameManager audio] ' + context, error),
        });
        this.unbindPlatformAudio = PlayableSDK.bindAudio(this.audioRuntime.manager);
        this.audioRuntime.addCleanup(this.unbindPlatformAudio);
        this.audioRuntime.manager.setSuspended('game-manager:disabled', !this.enabledInHierarchy);
        input.on(Input.EventType.TOUCH_END, this.onInteracted, this);
        input.on(Input.EventType.MOUSE_UP, this.onInteracted, this);
        input.on(Input.EventType.KEY_UP, this.onInteracted, this);
    }

    protected start() {
        // 系统监听屏幕变化
        if (this.backgroundMusic) this.audio?.createScope('game-manager-music')
            .play(this.backgroundMusic, { bus: 'music', loop: true, priority: 100 });

        view.on("canvas-resize", this.resize, this);
        this.scheduleOnce(this.resize);

        PlayableSDK.hideLoadingBar();
    }

    private _gameIsEnd: boolean = false;

    public gameEnd() {
        console.log("游戏结束");
        if (!this._gameIsEnd) {
            this._gameIsEnd = true;
            this.pauseGame(true);
            this.disposeAudio();
            this._gameEndEvent.invoke();
            input.on(Input.EventType.TOUCH_START, this.gameEnd, this);
        }
        // 游戏正式结束时调用
        PlayableSDK.download();
    }

    public pauseGame(value: boolean) {
        if (this._isPaused === value) return;
        this._isPaused = value;
        this.audio?.setSuspended('game-manager:paused', value);

        let index = 0;
        while (index < this._pausableObjectArr.length) {
            const obj = this._pausableObjectArr[index];
            if (!obj || (obj instanceof Component && !obj.isValid)) {
                this._pausableObjectArr[index] = this._pausableObjectArr[this._pausableObjectArr.length - 1];
                this._pausableObjectArr.pop();
            }
            else {
                obj.pause(value);
                index++;
            }
        }
    }

    public registerPausableObject(obj: IPausable) {
        this._pausableObjectArr.push(obj);
    }

    public unregisterPausableObject(obj: IPausable) {
        const index = this._pausableObjectArr.indexOf(obj);
        if (index !== -1) {
            // 使用数组尾部对象替换当前对象，然后删除数组尾部对象
            this._pausableObjectArr[index] = this._pausableObjectArr[this._pausableObjectArr.length - 1];
            this._pausableObjectArr.pop();
        }
    }

    private onInteracted(): void {
        this.audioRuntime?.unlock();
        PlayableSDK.onInteracted();
        this.removeInteractionListeners();
    }

    private removeInteractionListeners(): void {
        input.off(Input.EventType.TOUCH_END, this.onInteracted, this);
        input.off(Input.EventType.MOUSE_UP, this.onInteracted, this);
        input.off(Input.EventType.KEY_UP, this.onInteracted, this);
    }

    private disposeAudio(): void {
        this.removeInteractionListeners();
        this.unbindPlatformAudio?.(); this.unbindPlatformAudio = null;
        this.audioRuntime?.dispose(); this.audioRuntime = null;
    }

    protected onDisable(): void { this.audio?.setSuspended('game-manager:disabled', true); }
    protected onEnable(): void { this.audio?.setSuspended('game-manager:disabled', false); }

    protected onDestroy(): void {
        this.disposeAudio();
        view.off('canvas-resize', this.resize, this);
        input.off(Input.EventType.TOUCH_START, this.gameEnd, this);
        this.unschedule(this.resize);
        this._pausableObjectArr.length = 0;
    }

    public resize() {
        if (screen.windowSize.height > screen.windowSize.width && screen.windowSize.width / screen.windowSize.height < 1) {
            view.setResolutionPolicy(ResolutionPolicy.FIXED_WIDTH);
        }
        else {
            view.setResolutionPolicy(ResolutionPolicy.FIXED_HEIGHT);
        }
    }
}


