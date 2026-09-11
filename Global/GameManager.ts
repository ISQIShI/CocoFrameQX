import { _decorator, screen, view, input, ResolutionPolicy } from 'cc';
import { PlayableSDK } from '../Other/PlayableSDK';
import { PlayerAction } from '../Other/PrintComponent';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
const { ccclass, disallowMultiple } = _decorator;


export interface IPausable {
    pause(value: boolean): void;
}


@ccclass('GameManager')
@disallowMultiple(true)
export class GameManager extends ComponentSingletonBase {

    private _isPaused: boolean = false;

    private _pausableObjectArr: IPausable[] = [];

    public get isPaused(): boolean {
        return this._isPaused;
    }

    protected start() {
        // 系统监听屏幕变化
        view.on("canvas-resize", this.resize, this);
        this.scheduleOnce(this.resize);

        PlayableSDK.onInteracted();

        // if (window.setLoadingProgress) {
        //     window.setLoadingProgress(100);
        // }
    }

    protected gameEnd() {
        console.log("游戏结束");
        // 游戏正式结束时调用
        PlayableSDK.download(PlayerAction.download);
    }

    public pauseGame(value: boolean) {
        if (this._isPaused === value) return;
        this._isPaused = value;

        for (const obj of this._pausableObjectArr) {
            obj.pause(value);
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


