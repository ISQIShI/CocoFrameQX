import { Queue } from "../DataStructure/Queue";
import { IClip } from "./IClip";

export class ClipRunner {
    private _currentClip: IClip = null;

    private _clipQueue: Queue<IClip> = new Queue<IClip>();


    public get isRunning(): boolean {
        if (this._currentClip && !this._currentClip.isCompleted) return true;
        return !this._clipQueue.isEmpty;
    }

    public addClip(clip: IClip): ClipRunner {
        this._clipQueue.enqueue(clip);
        return this;
    }

    public update(deltaTime: number): void {
        if (!this._currentClip) {
            if (this._clipQueue.isEmpty) {
                return;
            }
            this._currentClip = this._clipQueue.dequeue();
            this._currentClip.onEnter();
        }
        while (this._currentClip.isCompleted) {
            this._currentClip.onExit();
            if (this._clipQueue.isEmpty) {
                this._currentClip = null;
                return;
            }
            this._currentClip = this._clipQueue.dequeue();
            this._currentClip.onEnter();
        }
        this._currentClip.onUpdate(deltaTime);
    }

}


