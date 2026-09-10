import { _decorator, Camera, Component } from 'cc';
import { CameraAction } from './CameraAction/CameraAction';

const { ccclass, property, disallowMultiple, menu } = _decorator;

@ccclass('CameraController')
@disallowMultiple(true)
@menu('Camera/CameraController')
export class CameraController extends Component {

    @property({ type: Camera, displayName: '摄像机组件', visible: true })
    private _camera: Camera;

    public get camera(): Camera {
        return this._camera;
    }

    private _currentAction: CameraAction;

    protected start(): void {
        if (!this._camera) {
            this._camera = this.getComponent(Camera);
        }
    }

    public stopAction(): void {
        if (this._currentAction) {
            this._currentAction.stop();
        }
    }

    public pauseAction(): void {
        if (this._currentAction) {
            this._currentAction.pause();
        }
    }

    public resumeAction(): void {
        if (this._currentAction) {
            this._currentAction.resume();
        }
    }

}


