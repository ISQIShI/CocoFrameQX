import { IVec3, IVec3Like, Node, Quat, Tween, Vec3, tween, v3 } from "cc";
import { MathUtil } from "./MathUtil";

export class TweenUtil {
    // 投掷到指定位置(世界坐标)
    public static throwToPos(node: Node, targetPos: IVec3 | (() => IVec3), delay: number, onUpdate?: () => void, controlPointHeight: number = 2): Tween<Node> {
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

                if (onUpdate) {
                    onUpdate();
                }
            });
        }
        else {
            t.update(delay, (target, ratio) => {
                controlPos.x = (startPos.x + targetPos.x) * 0.5;
                controlPos.y = (startPos.y + targetPos.y) * 0.5 + controlPointHeight;
                controlPos.z = (startPos.z + targetPos.z) * 0.5;
                MathUtil.bezierCurve(ratio, startPos, controlPos, targetPos, tempPos);
                target.setWorldPosition(tempPos);

                if (onUpdate) {
                    onUpdate();
                }
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
     * @param intensity 强度 (默认 1，0 为无形变，大于 1 增强形变)
     * @param finalScale 最终缩放
     */
    public static jelly(node: Node, intensity: number = 1, finalScale?: IVec3Like) {
        const finalScaleVec3 = new Vec3();
        if (finalScale) {
            finalScaleVec3.set(finalScale.x, finalScale.y, finalScale.z);
        } else {
            finalScaleVec3.set(node.scale);
        }

        const t = tween(node)
            .set({ scale: this.getJellyScale(finalScaleVec3, intensity, 0.6, 0.6, 0.6) })
            .to(0.15, { scale: finalScaleVec3 })
            .to(0.06, { scale: this.getJellyScale(finalScaleVec3, intensity, 1.4, 0.53, 1.4) })
            .to(0.12, { scale: this.getJellyScale(finalScaleVec3, intensity, 0.8, 1.2, 0.8) })
            .to(0.07, { scale: this.getJellyScale(finalScaleVec3, intensity, 1.2, 0.7, 1.2) })
            .to(0.07, { scale: this.getJellyScale(finalScaleVec3, intensity, 0.85, 1.1, 0.85) })
            .to(0.07, { scale: finalScaleVec3 });

        return t;
    }

    /**
     * @zh 计算受强度影响的缩放向量
     */
    private static getJellyScale(base: IVec3Like, intensity: number, fx: number, fy: number, fz: number): Vec3 {
        // 根据强度计算每个轴的实际缩放向量：finalScale * (1 + (factor - 1) * intensity)
        return new Vec3(
            base.x * (1 + (fx - 1) * intensity),
            base.y * (1 + (fy - 1) * intensity),
            base.z * (1 + (fz - 1) * intensity)
        );
    }

    /**
    * 让UI节点产生一次随机小晃动（带衰减与平滑归位）
    * @param target 目标UI节点
    * @param intensity 晃动剧烈程度（默认 10：最大偏移 10 像素，最大旋转 5 度）
    * @param duration 晃动总持续时间（秒，默认 0.4 秒）
    */
    public static shakeUI(target: Node, intensity: number = 10, duration: number = 0.4): Tween<Node> {
        const originPos = target.position.clone();
        const originEuler = target.eulerAngles.clone();

        const stepTime = 0.04;
        const steps = Math.max(2, Math.floor(duration / stepTime));
        const singleStepDuration = duration / steps;

        const t = tween(target);

        for (let i = 0; i < steps - 1; i++) {
            const damping = 1 - (i / steps);
            const curPosRange = intensity * damping;
            const curAngleRange = (intensity * 0.5) * damping;

            const offsetX = (Math.random() * 2 - 1) * curPosRange;
            const offsetY = (Math.random() * 2 - 1) * curPosRange;
            const offsetZAngle = (Math.random() * 2 - 1) * curAngleRange;

            t.to(singleStepDuration, {
                position: new Vec3(originPos.x + offsetX, originPos.y + offsetY, originPos.z),
                eulerAngles: new Vec3(originEuler.x, originEuler.y, originEuler.z + offsetZAngle)
            });
        }

        return t.to(singleStepDuration, {
            position: originPos,
            eulerAngles: originEuler
        }).start();
    }

    /**
    * 让UI节点产生一次左右摇摆晃动（仅Z轴旋转）
    * @param target 目标UI节点
    * @param intensity 晃动剧烈程度（默认 15：最大摇摆角度 ±15 度）
    * @param duration 晃动总持续时间（秒，默认 0.5 秒）
    */
    public static wobbleUI(target: Node, intensity: number = 15, duration: number = 0.5): Tween<Node> {
        const originEuler = target.eulerAngles.clone();

        const steps = 5;
        const stepTime = duration / steps;
        let dir = Math.random() > 0.5 ? 1 : -1;

        const t = tween(target);

        for (let i = 0; i < steps - 1; i++) {
            const damping = 1 - (i / steps);
            const randomFactor = 0.8 + Math.random() * 0.4;
            const angleZ = dir * intensity * damping * randomFactor;
            dir *= -1;

            t.to(stepTime, {
                eulerAngles: new Vec3(originEuler.x, originEuler.y, originEuler.z + angleZ)
            }, { easing: 'sineInOut' });
        }

        return t.to(stepTime, {
            eulerAngles: originEuler
        }, { easing: 'sineInOut' }).start();
    }
}
