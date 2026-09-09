import { _decorator, screen, view, input, ResolutionPolicy } from 'cc';
import { PlayableSDK } from '../Other/PlayableSDK';
import { PlayerAction } from '../Other/PrintComponent';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';


const { ccclass, disallowMultiple } = _decorator;

@ccclass('GameManager')
@disallowMultiple(true)
export class GameManager extends ComponentSingletonBase {

    private _isPause: boolean = false;

    public get isPause(): boolean {
        return this._isPause;
    }

    public set isPause(value: boolean) {
        if (this._isPause === value) return;
        this._isPause = value;
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

    protected onEnd() {
        // 游戏正式结束时调用
        PlayableSDK.download(PlayerAction.download);
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


