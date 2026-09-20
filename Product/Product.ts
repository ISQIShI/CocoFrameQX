import { _decorator, Component, IVec3, tween, Vec3 } from 'cc';
import { MathUtil } from '../Utils/MathUtil';
const { ccclass, property } = _decorator;

@ccclass('Product')
export class Product extends Component {

    private _isMoving = false;

    public get isMoving() {
        return this._isMoving;
    }

    // 投掷到指定位置(世界坐标)
    throwToPos(targetPos: IVec3 | (() => IVec3), delay: number, callback?) {
        this._isMoving = true;

        const startPos = this.node.worldPosition.clone();
        const controlPos = new Vec3();
        const tempPos = new Vec3();

        const t = tween(this.node);

        if (typeof targetPos === 'function') {
            t.update(delay, (target, ratio) => {
                const tempTargetPos = targetPos();
                controlPos.x = (startPos.x + tempTargetPos.x) * 0.5;
                controlPos.y = (startPos.y + tempTargetPos.y) * 0.5 + 2;
                controlPos.z = (startPos.z + tempTargetPos.z) * 0.5;
                MathUtil.bezierCurve(ratio, startPos, controlPos, tempTargetPos, tempPos);
                target.setWorldPosition(tempPos);
            });
        }
        else {
            t.update(delay, (target, ratio) => {
                controlPos.x = (startPos.x + targetPos.x) * 0.5;
                controlPos.y = (startPos.y + targetPos.y) * 0.5 + 2;
                controlPos.z = (startPos.z + targetPos.z) * 0.5;
                MathUtil.bezierCurve(ratio, startPos, controlPos, targetPos, tempPos);
                target.setWorldPosition(tempPos);
            });
        }

        t.call(() => {
            if (callback) callback();
            this._isMoving = false;
        }).start();
    }
}


