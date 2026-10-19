import { _decorator, AudioSource, Component, ResolutionPolicy, screen, view } from 'cc';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
import { AudioManager } from '../Other/AudioManager';
import { PlayableSDK } from '../SDK/PlayableSDK';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';

const { ccclass, disallowMultiple } = _decorator;

declare var window;

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

    private _audioSource: AudioSource = null!;

    protected onLoad(): void {
        this._audioSource = this.getComponent(AudioSource)!;
        // assert(audioSource);
        // director.addPersistRootNode(this.node);

        PlayableSDK.adapter();
        PlayableSDK.gameReady();

        // init AudioManager
        AudioManager.init(this._audioSource, this.node);

        let enableAudio = () => {
            console.log('AudioManager.resume');
            AudioManager.firstClick = true;
            AudioManager.resume();

            document.removeEventListener('mouseup', enableAudio, true);
            document.removeEventListener('touchend', enableAudio, true);
        }

        document.addEventListener('mouseup', enableAudio, true);
        document.addEventListener('touchend', enableAudio, true);
    }

    protected start() {
        // 系统监听屏幕变化
        AudioManager.musicPlay("bgm", true);

        view.on("canvas-resize", this.resize, this);
        this.scheduleOnce(this.resize);

        PlayableSDK.onInteracted();

        // if (window.setLoadingProgress) {
        //     window.setLoadingProgress(100);
        // }
        PlayableSDK.hideLoadingBar();


        // PhysicsSystem.instance.debugDrawFlags = EPhysicsDrawFlags.WIRE_FRAME;
        // PhysicsSystem.instance.debugDrawFlags =
        //     EPhysicsDrawFlags.WIRE_FRAME |
        //     EPhysicsDrawFlags.AABB;
    }

    public gameEnd() {
        console.log("游戏结束");
        AudioManager.musicStop();
        // 游戏正式结束时调用
        PlayableSDK.download();
        this._gameEndEvent.invoke();
    }

    public pauseGame(value: boolean) {
        if (this._isPaused === value) return;
        this._isPaused = value;

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

    public resize(e?) {
        if (screen.windowSize.height > screen.windowSize.width && screen.windowSize.width / screen.windowSize.height < 1) {
            view.setResolutionPolicy(ResolutionPolicy.FIXED_WIDTH);
        }
        else {
            view.setResolutionPolicy(ResolutionPolicy.FIXED_HEIGHT);
        }
    }
}


