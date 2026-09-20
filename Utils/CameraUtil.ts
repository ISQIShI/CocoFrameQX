import { Camera, easing as easingFunctions, Node, Quat, Tween, tween, Vec3 } from 'cc';
import type { IVec3, IVec3Like, TweenEasing } from 'cc';

/** 缓动曲线：支持内置缓动名或自定义缓动函数 */
export type CameraEasing = TweenEasing | ((k: number) => number);

/**
 * 摄像机行为工具类
 *
 * 每个静态方法只负责根据参数快速构造一个带有核心行为逻辑的 Tween 对象并返回，
 * 不负责启动 Tween，也不负责注册完成回调，调用方拿到后可自行追加设置（call/delay/repeat 等）再 start()。
 * 起始值统一在 Tween 首次执行时采样，因此支持"先构造、后启动"；目标值（含 Node 目标的世界坐标）在构造时确定。
 */
export class CameraUtil {

    // =========================================================================
    // 移动 (Move & Pan)
    // =========================================================================

    /**
     * 构造一个平滑移动摄像机世界坐标的 Tween
     * @param node 摄像机节点
     * @param target 目标世界坐标，或作为目标点的节点（取其构造时的世界坐标）
     * @param duration 移动时长（秒），传 0 表示下一帧直接到位
     * @param easing 可选缓动曲线
     */
    public static moveTo(
        node: Node,
        target: Readonly<Vec3> | Node,
        duration: number = 0.5,
        easing?: CameraEasing
    ): Tween<Node> {
        const destPos = new Vec3();
        CameraUtil.readWorldPosition(target, destPos);

        return CameraUtil.buildMove(node, destPos, false, duration, easing);
    }

    /**
     * 构造一个相对当前位置平滑偏移的 Tween
     * @param node 摄像机节点
     * @param offset 相对世界坐标偏移量
     * @param duration 移动时长（秒）
     * @param easing 可选缓动曲线
     */
    public static moveBy(
        node: Node,
        offset: Readonly<Vec3>,
        duration: number = 0.5,
        easing?: CameraEasing
    ): Tween<Node> {
        const offsetPos = new Vec3(offset.x, offset.y, offset.z);

        return CameraUtil.buildMove(node, offsetPos, true, duration, easing);
    }

    // =========================================================================
    // 缩放 / 拉近拉远 (Zoom)
    // =========================================================================

    /**
     * 获取摄像机当前缩放值：正交模式为 orthoHeight，透视模式为 fov
     */
    public static getZoom(camera: Camera): number {
        if (!camera) return 0;
        return camera.projection === Camera.ProjectionType.ORTHO ? camera.orthoHeight : camera.fov;
    }

    /**
     * 构造一个平滑缩放到指定值的 Tween
     * 正交模式写入 orthoHeight，透视模式写入 fov
     * @param camera 摄像机组件
     * @param targetZoom 目标缩放值（越小越拉近，越大越拉远）
     * @param duration 过渡时长（秒）
     * @param minZoom 可选缩放下限
     * @param maxZoom 可选缩放上限
     * @param easing 可选缓动曲线
     */
    public static zoomTo(
        camera: Camera,
        targetZoom: number,
        duration: number = 0.5,
        minZoom?: number,
        maxZoom?: number,
        easing?: CameraEasing
    ): Tween<Camera> {
        let dest = targetZoom;
        if (minZoom !== undefined) dest = Math.max(dest, minZoom);
        if (maxZoom !== undefined) dest = Math.min(dest, maxZoom);

        const opts = easing !== undefined ? { easing } : undefined;
        const time = Math.max(duration, 0);

        if (camera.projection === Camera.ProjectionType.ORTHO) {
            return tween(camera).to(time, { orthoHeight: dest }, opts);
        }
        return tween(camera).to(time, { fov: dest }, opts);
    }

    /**
     * 构造一个增量缩放 Tween
     * @param delta 变化量（负值拉近，正值拉远）
     */
    public static zoomBy(
        camera: Camera,
        delta: number,
        duration: number = 0.5,
        minZoom?: number,
        maxZoom?: number,
        easing?: CameraEasing
    ): Tween<Camera> {
        return CameraUtil.zoomTo(camera, CameraUtil.getZoom(camera) + delta, duration, minZoom, maxZoom, easing);
    }

    /**
     * 构造一个按当前缩放值比例缩放的 Tween
     * @param ratio 比例系数，例如 0.5 表示拉近到当前的一半
     */
    public static zoomToRatio(
        camera: Camera,
        ratio: number,
        duration: number = 0.5,
        minZoom?: number,
        maxZoom?: number,
        easing?: CameraEasing
    ): Tween<Camera> {
        return CameraUtil.zoomTo(camera, CameraUtil.getZoom(camera) * ratio, duration, minZoom, maxZoom, easing);
    }

    /**
     * 构造一个按比例增量缩放的 Tween
     * @param ratioDelta 比例增量，例如 -0.2 表示在当前基础上拉近 20%
     */
    public static zoomByRatio(
        camera: Camera,
        ratioDelta: number,
        duration: number = 0.5,
        minZoom?: number,
        maxZoom?: number,
        easing?: CameraEasing
    ): Tween<Camera> {
        return CameraUtil.zoomToRatio(camera, 1 + ratioDelta, duration, minZoom, maxZoom, easing);
    }

    // =========================================================================
    // 旋转与朝向 (Rotate & LookAt)
    // =========================================================================

    /**
     * 构造一个平滑朝向目标点的 Tween（内部使用四元数球面插值，不会出现欧拉角翻转）
     * @param node 摄像机节点
     * @param target 目标世界坐标，或作为目标点的节点（取其构造时的世界坐标）
     * @param duration 过渡时长（秒）
     * @param easing 可选缓动曲线
     */
    public static lookAt(
        node: Node,
        target: Readonly<Vec3> | Node,
        duration: number = 0.5,
        easing?: CameraEasing
    ): Tween<Node> {
        const destPos = new Vec3();
        CameraUtil.readWorldPosition(target, destPos);

        const startRot = new Quat();
        const endRot = new Quat();
        const dir = new Vec3();
        const tempRot = new Quat();
        const ease = CameraUtil.resolveEasing(easing);
        let captured = false;

        return tween(node).update(Math.max(duration, 0), (_target, ratio) => {
            if (!captured) {
                startRot.set(node.worldRotation);
                Vec3.subtract(dir, destPos, node.worldPosition);
                if (dir.lengthSqr() > 1e-6) {
                    Quat.fromViewUp(endRot, Vec3.normalize(dir, dir), Vec3.UNIT_Y);
                } else {
                    endRot.set(startRot);
                }
                captured = true;
            }
            Quat.slerp(tempRot, startRot, endRot, ease ? ease(ratio) : ratio);
            node.setWorldRotation(tempRot);
        });
    }

    /**
     * 构造一个平滑旋转到指定欧拉角的 Tween
     * @param node 摄像机节点
     * @param euler 目标欧拉角（角度制）
     * @param duration 过渡时长（秒）
     * @param easing 可选缓动曲线
     */
    public static rotateTo(
        node: Node,
        euler: Readonly<Vec3>,
        duration: number = 0.5,
        easing?: CameraEasing
    ): Tween<Node> {
        const endRot = new Quat();
        Quat.fromEuler(endRot, euler.x, euler.y, euler.z);

        const startRot = new Quat();
        const tempRot = new Quat();
        const ease = CameraUtil.resolveEasing(easing);
        let captured = false;

        return tween(node).update(Math.max(duration, 0), (_target, ratio) => {
            if (!captured) {
                startRot.set(node.worldRotation);
                captured = true;
            }
            Quat.slerp(tempRot, startRot, endRot, ease ? ease(ratio) : ratio);
            node.setWorldRotation(tempRot);
        });
    }

    /**
     * 构造一个相对当前旋转增量旋转的 Tween
     * @param node 摄像机节点
     * @param eulerDelta 欧拉角增量（角度制）
     * @param duration 过渡时长（秒）
     * @param easing 可选缓动曲线
     */
    public static rotateBy(
        node: Node,
        eulerDelta: Readonly<Vec3>,
        duration: number = 0.5,
        easing?: CameraEasing
    ): Tween<Node> {
        const endEuler = new Vec3();
        Vec3.add(endEuler, node.eulerAngles, eulerDelta);

        return CameraUtil.rotateTo(node, endEuler, duration, easing);
    }

    // =========================================================================
    // 震屏 (Shake)
    // =========================================================================

    /**
     * 构造一个震屏 Tween（基于 update 逐帧叠加随机位移，不破坏 Tween 之外的其他位置行为）
     *
     * 震动以"相对偏移"方式叠加在节点当前位姿之上，Tween 正常结束时会在最后一帧自动归还偏移；
     * 若中途 stop() 则可能残留当帧偏移，调用方可在 stop 后自行矫正。
     *
     * @param node 摄像机节点
     * @param duration 震动持续时间（秒），最小 0.05
     * @param intensity 位移震动幅度（世界单位）
     * @param decay 是否随时间线性衰减，默认 true
     * @param rotateIntensity 旋转震动幅度（角度制，0 表示不震旋转），默认 0
     * @param axisMask 位移轴向权重，例如 (1, 0, 1) 表示忽略 Y 轴
     */
    public static shake(
        node: Node,
        duration: number = 0.3,
        intensity: number = 0.2,
        decay: boolean = true,
        rotateIntensity: number = 0,
        axisMask?: Readonly<Vec3>
    ): Tween<Node> {
        const total = Math.max(duration, 0.05);
        const amplitude = Math.max(intensity, 0);
        const rotateAmplitude = Math.max(rotateIntensity, 0);
        const maskX = axisMask ? axisMask.x : 1;
        const maskY = axisMask ? axisMask.y : 1;
        const maskZ = axisMask ? axisMask.z : 1;

        const offset = new Vec3();
        const tempPos = new Vec3();
        const rotOffset = new Quat();
        const inverseRot = new Quat();
        const tempRot = new Quat();

        // 归还当前帧偏移，使节点回到未震动时的位姿
        const restore = () => {
            Vec3.subtract(tempPos, node.worldPosition, offset);
            node.setWorldPosition(tempPos);
            offset.set(0, 0, 0);

            if (rotateAmplitude > 0) {
                Quat.invert(inverseRot, rotOffset);
                Quat.multiply(tempRot, node.worldRotation, inverseRot);
                node.setWorldRotation(tempRot);
                rotOffset.set(0, 0, 0, 1);
            }
        };

        return tween(node)
            .update(total, (_target, ratio) => {
                if (ratio >= 1) {
                    restore();
                    return;
                }

                // 先扣除上一帧的震动偏移，保证叠加在其他行为的结果之上
                Vec3.subtract(tempPos, node.worldPosition, offset);

                const k = decay ? 1 - ratio : 1;
                offset.set(
                    (Math.random() * 2 - 1) * amplitude * k * maskX,
                    (Math.random() * 2 - 1) * amplitude * k * maskY,
                    (Math.random() * 2 - 1) * amplitude * k * maskZ
                );
                Vec3.add(tempPos, tempPos, offset);
                node.setWorldPosition(tempPos);

                if (rotateAmplitude > 0) {
                    Quat.invert(inverseRot, rotOffset);
                    Quat.multiply(tempRot, node.worldRotation, inverseRot);

                    const rk = rotateAmplitude * k;
                    Quat.fromEuler(
                        rotOffset,
                        (Math.random() * 2 - 1) * rk,
                        (Math.random() * 2 - 1) * rk,
                        (Math.random() * 2 - 1) * rk
                    );
                    Quat.multiply(tempRot, tempRot, rotOffset);
                    node.setWorldRotation(tempRot);
                }
            })
            .call(restore);
    }

    /**
     * 计算焦点偏移
     * @param out 输出向量
     * @param camera 摄像机
     * @param distance 距离
     * @param target 目标
     */
    public static calculateFocusOffset<Out extends IVec3Like>(out: Out, camera: Camera, target: IVec3Like, distance: number): Out {
        // 定义摄像机相对于目标的局部偏移量（在正后方 distance 距离处）
        out.x = 0;
        out.y = 0;
        out.z = distance;
        // 用现有的旋转四元数，将这个局部偏移量转换到世界坐标系下
        Vec3.transformQuat(out, out, camera.node.worldRotation);
        // 计算最终位置：目标点坐标 + 世界偏移量
        out.x = target.x + out.x;
        out.y = target.y + out.y;
        out.z = target.z + out.z;
        return out;
    }

    // =========================================================================
    // 内部实现 (Private Helpers)
    // =========================================================================

    /**
     * 构造移动 Tween：起始位置在首次执行时采样，支持延迟启动
     * @param dest 目标世界坐标；relative 为 true 时表示相对起始位置的偏移量
     * @param relative 是否按相对偏移计算终点
     */
    private static buildMove(
        node: Node,
        dest: Readonly<Vec3>,
        relative: boolean,
        duration: number,
        easing?: CameraEasing
    ): Tween<Node> {
        const startPos = new Vec3();
        const endPos = new Vec3();
        const tempPos = new Vec3();
        const ease = CameraUtil.resolveEasing(easing);
        let captured = false;

        return tween(node).update(Math.max(duration, 0), (_target, ratio) => {
            if (!captured) {
                startPos.set(node.worldPosition);
                if (relative) {
                    Vec3.add(endPos, startPos, dest);
                } else {
                    endPos.set(dest.x, dest.y, dest.z);
                }
                captured = true;
            }
            Vec3.lerp(tempPos, startPos, endPos, ease ? ease(ratio) : ratio);
            node.setWorldPosition(tempPos);
        });
    }

    /**
     * 读取目标的世界坐标：Node 取 worldPosition，其余按向量处理
     */
    private static readWorldPosition(target: Readonly<Vec3> | Node, out: Vec3): Vec3 {
        if (target instanceof Node) {
            const worldPos = target.worldPosition;
            return out.set(worldPos.x, worldPos.y, worldPos.z);
        }
        return out.set(target.x, target.y, target.z);
    }

    /**
     * 解析缓动参数为可调用函数
     */
    private static resolveEasing(easing?: CameraEasing): ((k: number) => number) | null {
        if (!easing) return null;
        if (typeof easing === 'function') return easing;
        const fn = (easingFunctions as unknown as Record<string, (k: number) => number>)[easing];
        return fn ?? null;
    }
}