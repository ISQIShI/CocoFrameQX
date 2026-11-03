import { RingDeque } from '../DataStructure/RingDeque';
import { IClip } from "./IClip";

export class ClipRunner {
    private _currentClip: IClip = null;

    private _clipQueue = new RingDeque<IClip>();


    public get isRunning(): boolean {
        if (this._currentClip && !this._currentClip.isCompleted) return true;
        return this._clipQueue.size > 0;
    }

    public addClip(clip: IClip): ClipRunner {
        this._clipQueue.pushBack(clip);
        return this;
    }

    public update(deltaTime: number): void {
        if (!this._currentClip) {
            if (this._clipQueue.size === 0) {
                return;
            }
            this._currentClip = this._clipQueue.popFront()!;
            this._currentClip.onEnter();
        }
        while (this._currentClip.isCompleted) {
            this._currentClip.onExit();
            if (this._clipQueue.size === 0) {
                this._currentClip = null;
                return;
            }
            this._currentClip = this._clipQueue.popFront()!;
            this._currentClip.onEnter();
        }
        this._currentClip.onUpdate(deltaTime);
    }

}


