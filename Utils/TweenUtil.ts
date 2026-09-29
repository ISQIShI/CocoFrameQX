import { IVec3, Node, Tween, Vec3, tween } from "cc";
import { MathUtil } from "./MathUtil";

export class TweenUtil {
    // 投掷到指定位置(世界坐标)
    public static throwToPos(node: Node, targetPos: IVec3 | (() => IVec3), delay: number): Tween<Node> {
        const startPos = node.worldPosition.clone();
        const controlPos = new Vec3();
        const tempPos = new Vec3();

        const t = tween(node);

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

        return t;
    }
}


