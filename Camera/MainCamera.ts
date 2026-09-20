import { _decorator, Camera, screen, view } from 'cc';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
const { ccclass, property, disallowMultiple, menu } = _decorator;

const enum ScreenMode {
    Landscape,
    Portrait,
}

@ccclass('MainCamera')
@disallowMultiple(true)
@menu('Camera/MainCamera')
export class MainCamera extends ComponentSingletonBase {
    @property({ type: Camera, displayName: '主摄像机组件', visible: true })
    private _camera: Camera = null;

    public get camera(): Camera {
        return this._camera;
    }

    private _onSolutionChange: MulticastDelegate<(mainCamera: MainCamera, width: number, height: number) => void>;

    public get onSolutionChange(): MulticastDelegate<(mainCamera: MainCamera, width: number, height: number) => void> {
        if (!this._onSolutionChange) {
            this._onSolutionChange = new MulticastDelegate<(mainCamera: MainCamera, width: number, height: number) => void>();
        }
        return this._onSolutionChange;
    }

    private _screenMode: ScreenMode = ScreenMode.Landscape;

    public get screenMode(): ScreenMode {
        return this._screenMode;
    }

    protected onLoad(): void {
        if (!this._camera) {
            this._camera = this.node.getComponent(Camera);
        }
    }

    protected start(): void {
        // 系统监听屏幕变化
        view.on("canvas-resize", this.adaptiveSolution, this);
        this.scheduleOnce(this.adaptiveSolution);
    }

    private adaptiveSolution() {
        if (screen.windowSize.height > screen.windowSize.width && screen.windowSize.width / screen.windowSize.height < 1) {
            //竖屏
            this._screenMode = ScreenMode.Portrait;
        } else {
            //横屏
            this._screenMode = ScreenMode.Landscape;
        }

        this._onSolutionChange?.invoke(this, screen.windowSize.width, screen.windowSize.height);
    }
}


