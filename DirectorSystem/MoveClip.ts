import { IVec3, Node, Vec3 } from "cc";
import { NodeUtil } from "../Utils/NodeUtil";
import { IClip } from "./IClip";

export class MoveClip implements IClip {

    private _targetNode: Node = null;

    private _targetPos: Vec3 = new Vec3();

    public get targetPos(): Vec3 {
        return this._targetPos;
    }

    private _moveSpeed: number = 0;

    public get moveSpeed(): number {
        return this._moveSpeed;
    }

    private _isCompleted: boolean = false;

    public get isCompleted(): boolean {
        return this._isCompleted;
    }

    private _onEnterFunc: (clip: MoveClip) => void = null;

    private _onUpdateFunc: (clip: MoveClip, deltaTime: number) => void = null;

    private _onExitFunc: (clip: MoveClip) => void = null;

    public constructor(targetNode: Node, targetPos?: IVec3, moveSpeed?: number) {
        this._targetNode = targetNode;
        if (targetPos) {
            this._targetPos.set(targetPos.x, targetPos.y, targetPos.z);
        }
        if (moveSpeed) {
            this._moveSpeed = moveSpeed;
        }
    }

    public moveTo(targetPos: IVec3): MoveClip {
        this._targetPos.set(targetPos.x, targetPos.y, targetPos.z);
        return this;
    }

    public setX(x: number): MoveClip {
        this._targetPos.x = x;
        return this;
    }

    public setY(y: number): MoveClip {
        this._targetPos.y = y;
        return this;
    }

    public setZ(z: number): MoveClip {
        this._targetPos.z = z;
        return this;
    }

    public setSpeed(speed: number): MoveClip {
        this._moveSpeed = speed;
        return this;
    }

    public executeOnEnter(func: (clip: MoveClip) => void): MoveClip {
        this._onEnterFunc = func;
        return this;
    }

    public executeOnUpdate(func: (clip: MoveClip, deltaTime: number) => void): MoveClip {
        this._onUpdateFunc = func;
        return this;
    }

    public executeOnExit(func: (clip: MoveClip) => void): MoveClip {
        this._onExitFunc = func;
        return this;
    }

    public onEnter(): void {
        this._onEnterFunc && this._onEnterFunc(this);
    }
    public onUpdate(deltaTime: number): void {
        if (NodeUtil.moveToPos(deltaTime, this._targetPos, this._moveSpeed, this._targetNode)) {
            this._isCompleted = true;
        }
        this._onUpdateFunc && this._onUpdateFunc(this, deltaTime);
    }
    public onExit(): void {
        this._onExitFunc && this._onExitFunc(this);
    }
}


