import { _decorator, Camera, Component } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('FaceToCamera')
export class FaceToCamera extends Component {
    @property({ type: Camera, visible: true })
    private _camera: Camera;

    public get camera(): Camera {
        return this._camera;
    }

    public set camera(value: Camera) {
        this._camera = value;
        // 如果设置了摄像机，则启用组件，否则禁用组件
        this.enabled = !!value;
    }

    protected start(): void {
        this.enabled = !!this._camera;
    }

    protected update(deltaTime: number) {
        this.node.worldRotation = this._camera.node.worldRotation;
    }
}


