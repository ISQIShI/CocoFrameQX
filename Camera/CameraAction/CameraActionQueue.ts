import { Queue } from "../../DataStructure/Queue";
import { CameraController } from "../CameraController";
import { CameraAction } from "./CameraAction";


export class CameraActionQueue extends CameraAction {
    private _cameraActionQueue: Queue<CameraAction> = new Queue<CameraAction>();

    public constructor(cameraController: CameraController) {
        super(cameraController);
    }

    public addAction(action: CameraAction): CameraActionQueue {
        this._cameraActionQueue.enqueue(action);
        return this;
    }

    public execute(): void {
        this.executeNextAction();
    }

    private executeNextAction(): void {
        if (this._cameraActionQueue.isEmpty) {
            this._callBack && this._callBack.invoke(this._cameraController);
            return;
        }
        const action = this._cameraActionQueue.peek();
        action.call(() => {
            this._cameraActionQueue.dequeue();
            this.executeNextAction();
        }).execute();
    }

    public stop(): void {
        if (this._cameraActionQueue.isEmpty) {
            return;
        }
        this._cameraActionQueue.peek().stop();
    }

    public pause(): void {
        if (this._cameraActionQueue.isEmpty) {
            return;
        }
        this._cameraActionQueue.peek().pause();
    }

    public resume(): void {
        if (this._cameraActionQueue.isEmpty) {
            return;
        }
        this._cameraActionQueue.peek().resume();
    }
}


