import { IClip } from "./IClip";

export class CustomClip implements IClip {

    private _onEnterFunc: (clip: CustomClip) => void = null;

    private _onUpdateFunc: (clip: CustomClip, deltaTime: number) => void = null;

    private _onExitFunc: (clip: CustomClip) => void = null;

    private _isCompletedFunc: () => boolean = null;

    public executeOnEnter(func: (clip: CustomClip) => void): CustomClip {
        this._onEnterFunc = func;
        return this;
    }

    public executeOnUpdate(func: (clip: CustomClip, deltaTime: number) => void): CustomClip {
        this._onUpdateFunc = func;
        return this;
    }

    public executeOnExit(func: (clip: CustomClip) => void): CustomClip {
        this._onExitFunc = func;
        return this;
    }

    public setClipCompletedCondition(func: () => boolean): CustomClip {
        this._isCompletedFunc = func;
        return this;
    }

    get isCompleted(): boolean {
        return this._isCompletedFunc ? this._isCompletedFunc() : true;
    }

    public onEnter() {
        this._onEnterFunc && this._onEnterFunc(this);
    }

    public onUpdate(deltaTime: number) {
        this._onUpdateFunc && this._onUpdateFunc(this, deltaTime);
    }

    public onExit() {
        this._onExitFunc && this._onExitFunc(this);
    }
}


