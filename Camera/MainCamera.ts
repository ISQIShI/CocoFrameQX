import { _decorator, Camera, screen, Vec3, view } from 'cc';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
import { CameraFollow } from './CameraFollow';
const { ccclass, property, requireComponent, disallowMultiple } = _decorator;

@ccclass('MainCamera')
@disallowMultiple(true)
export class MainCamera extends ComponentSingletonBase {

    @property({ type: Camera, tooltip: '主摄像机组件' })
    public mainCamera: Camera = null;

    public eulerHeng = new Vec3(-40, 0, 0);
    public eulerShu = new Vec3(-40, 0, 0);

    @property(Vec3)
    public hengPos = new Vec3(0, 10, 12.5);

    @property(Vec3)
    public shuPos = new Vec3(0, 10, 12.5);

    public offsetPos = new Vec3(0, 0, 0);
    public initOrthoHeight: number = 0;
    public targetOrthoHeight: number = 0;

    protected onLoad(): void {
        if (!this.mainCamera) {
            this.mainCamera = this.node.getComponent(Camera);
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
            this.node.setRotationFromEuler(this.eulerShu);
            this.offsetPos = this.shuPos;
            this.mainCamera.orthoHeight = 3.5;
            this.initOrthoHeight = 2.5;
            this.targetOrthoHeight = 4.5;

        } else {
            //横屏
            this.node.setRotationFromEuler(this.eulerHeng);
            this.offsetPos = this.hengPos;
            this.mainCamera.orthoHeight = 3.5;
            this.initOrthoHeight = 2;
            this.targetOrthoHeight = 3.5;
        }

        let cameraFollow = this.node.getComponent(CameraFollow);
        if (cameraFollow) {
            cameraFollow.offset = this.offsetPos;
        }
    }
}


