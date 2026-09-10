import { _decorator, Camera, screen, Vec3, view } from 'cc';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
import { CameraFollow } from './CameraFollow';
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
    private _mainCamera: Camera = null;

    @property({ displayName: '横屏时摄像机的欧拉角', group: { id: 'landscape', name: '横屏设置' } })
    public landscapeEuler = new Vec3(-40, 0, 0);

    @property({ displayName: '横屏时摄像机的偏移量', group: { id: 'landscape', name: '横屏设置' } })
    public landscapeOffset = new Vec3(0, 10, 12.5);

    @property({ displayName: '竖屏时摄像机的欧拉角', group: { id: 'portrait', name: '竖屏设置' } })
    public portraitEuler = new Vec3(-40, 0, 0);

    @property({ displayName: '竖屏时摄像机的偏移量', group: { id: 'portrait', name: '竖屏设置' } })
    public portraitOffset = new Vec3(0, 10, 12.5);

    public get offsetPos() {
        return this._screenMode === ScreenMode.Landscape ? this.landscapeOffset : this.portraitOffset;
    }

    private _screenMode: ScreenMode = ScreenMode.Landscape;

    protected onLoad(): void {
        if (!this._mainCamera) {
            this._mainCamera = this.node.getComponent(Camera);
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
            this.node.setRotationFromEuler(this.portraitEuler);
            this._screenMode = ScreenMode.Portrait;
        } else {
            //横屏
            this.node.setRotationFromEuler(this.landscapeEuler);
            this._screenMode = ScreenMode.Landscape;
        }

        let cameraFollow = this.node.getComponent(CameraFollow);
        if (cameraFollow) {
            cameraFollow.followOffset = this.offsetPos;
        }
    }
}


