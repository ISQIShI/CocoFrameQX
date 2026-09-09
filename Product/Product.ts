import { _decorator, Component, tween, Vec3 } from 'cc';
import { MathUtil } from '../Utils/MathUtil';
const { ccclass, property } = _decorator;

@ccclass('Product')
export class Product extends Component {

    private _isMoving = false;

    public get isMoving() {
        return this._isMoving;
    }

    // 投掷到指定位置(世界坐标)
    throwToPos(targetPosFunc: () => Vec3, delay: number, callback?) {
        this._isMoving = true;
        const startPos = this.node.worldPosition.clone();
        const controlPos = new Vec3();
        Vec3.add(controlPos, startPos, targetPosFunc());
        controlPos.multiplyScalar(0.5);
        controlPos.add3f(0, 2, 0); // 控制点在起点和终点的中间，并向上偏移
        let tempPos = new Vec3();
        let t = tween(this.node)
            .update(delay, (target, ratio) => {
                MathUtil.bezierCurve(ratio, startPos, controlPos, targetPosFunc(), tempPos);
                target.setWorldPosition(tempPos);
            })
            .call(() => {
                if (callback) callback();
                this._isMoving = false;
            })
            .start();
    }
}


