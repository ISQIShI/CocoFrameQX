import { MulticastDelegate } from "../../Delegate/MulticastDelegate";
import { CameraController } from "../CameraController";

export abstract class CameraAction {

    protected _cameraController: CameraController;

    protected _callBack: MulticastDelegate<(cameraController: CameraController) => void>;

    protected constructor(cameraController: CameraController) {
        this._cameraController = cameraController;
    }

    public call(callBack: (cameraController: CameraController) => void): this {
        if (!this._callBack) {
            this._callBack = new MulticastDelegate<(cameraController: CameraController) => void>();
        }
        this._callBack.add(callBack);
        return this;
    }

    public abstract execute(): void;

    public abstract stop(): void;

    public abstract pause(): void;

    public abstract resume(): void;
}


