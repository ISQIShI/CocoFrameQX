import { IVec3, IVec3Like, Node, Quat, Tween, Vec3, tween, v3 } from "cc";
import { MathUtil } from "./MathUtil";

export class TweenUtil {
    // 投掷到指定位置(世界坐标)
    public static throwToPos(node: Node, targetPos: IVec3 | (() => IVec3), delay: number, controlPointHeight: number = 2): Tween<Node> {
        const startPos = node.worldPosition.clone();
        const controlPos = new Vec3();
        const tempPos = new Vec3();

        const t = tween(node);

        if (typeof targetPos === 'function') {
            t.update(delay, (target, ratio) => {
                const tempTargetPos = targetPos();
                controlPos.x = (startPos.x + tempTargetPos.x) * 0.5;
                controlPos.y = (startPos.y + tempTargetPos.y) * 0.5 + controlPointHeight;
                controlPos.z = (startPos.z + tempTargetPos.z) * 0.5;
                MathUtil.bezierCurve(ratio, startPos, controlPos, tempTargetPos, tempPos);
                target.setWorldPosition(tempPos);
            });
        }
        else {
            t.update(delay, (target, ratio) => {
                controlPos.x = (startPos.x + targetPos.x) * 0.5;
                controlPos.y = (startPos.y + targetPos.y) * 0.5 + controlPointHeight;
                controlPos.z = (startPos.z + targetPos.z) * 0.5;
                MathUtil.bezierCurve(ratio, startPos, controlPos, targetPos, tempPos);
                target.setWorldPosition(tempPos);
            });
        }

        return t;
    }

    /**
    * @zh 通过角度平滑旋转
    * @param node 节点
    * @param targetRotation 目标角度
    * @param during 旋转速度
    */
    public static setRotationSlerpByAngle(node: Node, targetRotation: Quat, during: number = 0.5): Tween<Node> {
        const t = tween(node)
            .to(during, { rotation: targetRotation }, { easing: 'quadOut' });

        return t;
    }

    /**
     * @zh 出现动画
     * @param node 节点
     * @param finalScale 最终缩放
     * @param expandTargetScale 放大目标缩放
     * @param expandDuration 展开持续时间
     * @param shrinkDuration 收缩持续时间
     */
    public static appear(node: Node, finalScale?: IVec3Like, expandTargetScale?: IVec3Like, expandDuration: number = 0.3, shrinkDuration: number = 0.15): Tween<Node> {
        const finalScaleVec3 = new Vec3();
        if (finalScale) {
            finalScaleVec3.set(finalScale.x, finalScale.y, finalScale.z);
        }
        else {
            finalScaleVec3.set(node.scale);
        }

        const targetScaleVec3 = new Vec3();
        if (expandTargetScale) {
            targetScaleVec3.set(expandTargetScale.x, expandTargetScale.y, expandTargetScale.z);
        }
        else {
            Vec3.multiplyScalar(targetScaleVec3, finalScaleVec3, 1.3);
        }

        const t = tween(node)
            .set({ scale: Vec3.ZERO })
            .to(expandDuration, { scale: targetScaleVec3 }, { easing: 'quadInOut' })
            .to(shrinkDuration, { scale: finalScaleVec3 }, { easing: 'quadInOut' });

        return t;
    }

    /**
     * @zh 消失动画
     * @param node 节点
     * @param finalScale 最终缩放
     * @param expandTargetScale 放大目标缩放
     * @param expandDuration 展开持续时间
     * @param shrinkDuration 收缩持续时间
     */
    public static disappear(node: Node, expandDuration: number = 0.3, shrinkDuration: number = 0.1, expandTargetScale?: IVec3Like, finalScale?: IVec3Like): Tween<Node> {
        const targetScaleVec3 = new Vec3();
        if (expandTargetScale) {
            targetScaleVec3.set(expandTargetScale.x, expandTargetScale.y, expandTargetScale.z);
        }
        else {
            Vec3.multiplyScalar(targetScaleVec3, node.scale, 1.3);
        }

        let finalScaleVec3: Vec3 = null;
        if (finalScale) {
            finalScaleVec3 = new Vec3();
            finalScaleVec3.set(finalScale.x, finalScale.y, finalScale.z);
        }
        else {
            finalScaleVec3 = Vec3.ZERO;
        }

        const t = tween(node)
            .to(expandDuration, { scale: targetScaleVec3 }, { easing: 'quadInOut' })
            .to(shrinkDuration, { scale: finalScaleVec3 }, { easing: 'quadInOut' });

        return t;
    }

    /**
     * @zh 果冻效果
     * @param node 节点
     * @param intensity 强度
     * @param finalScale 最终缩放
     */
    public static jelly(node: Node, intensity: number = 1, finalScale?: IVec3Like) {
        const finalScaleVec3 = new Vec3();
        if (finalScale) {
            finalScaleVec3.set(finalScale.x, finalScale.y, finalScale.z);
        }
        else {
            finalScaleVec3.set(node.scale);
        }

        const t = tween(node)
            .set({ scale: finalScaleVec3.clone().multiply3f(0.6, 0.6, 0.6) })
            .to(0.15, { scale: finalScaleVec3 })
            .to(0.06, { scale: finalScaleVec3.clone().multiply3f(1.4, 0.53, 1.4).multiplyScalar(intensity) })
            .to(0.12, { scale: finalScaleVec3.clone().multiply3f(0.8, 1.2, 0.8).multiplyScalar(intensity) })
            .to(0.07, { scale: finalScaleVec3.clone().multiply3f(1.2, 0.7, 1.2).multiplyScalar(intensity) })
            .to(0.07, { scale: finalScaleVec3.clone().multiply3f(0.85, 1.1, 0.85).multiplyScalar(intensity) })
            .to(0.07, { scale: finalScaleVec3 });

        return t;
    }
}
