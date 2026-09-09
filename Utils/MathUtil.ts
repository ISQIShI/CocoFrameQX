import { IVec3, math, Vec3 } from 'cc';

export class MathUtil {

    /** 三维向量线性插值，结果写入 out，避免每帧产生临时对象。 */
    public static lerpVec3(from: IVec3, to: IVec3, t: number, out: Vec3): Vec3 {
        out.set(
            math.lerp(from.x, to.x, t),
            math.lerp(from.y, to.y, t),
            math.lerp(from.z, to.z, t)
        );
        return out;
    }

    /** 将数值从一个范围映射到另一个范围。 */
    public static remap(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
        return math.lerp(toMin, toMax, math.inverseLerp(fromMin, fromMax, value));
    }

    /** 平滑的 [0, 1] 插值，常用于角色加速、相机跟随和 UI 动画。 */
    public static smoothStep(edge0: number, edge1: number, value: number): number {
        const t = math.clamp01(math.inverseLerp(edge0, edge1, value));
        return t * t * (3 - 2 * t);
    }

    /** 将 value 循环限制在 [0, length)。 */
    public static repeat(value: number, length: number): number {
        length = Math.abs(length);
        if (length <= math.EPSILON) return 0;
        return value - Math.floor(value / length) * length;
    }

    /** 往返循环值，常用于摆动、巡逻和循环动画。 */
    public static pingPong(value: number, length: number): number {
        length = Math.abs(length);
        if (length <= math.EPSILON) return 0;
        const cycle = MathUtil.repeat(value, length * 2);
        return length - Math.abs(cycle - length);
    }

    /** 每帧最多移动 maxDelta，避免超过目标点。 */
    public static moveTowards(current: number, target: number, maxDelta: number): number {
        if (Math.abs(target - current) <= Math.max(0, maxDelta)) return target;
        return current + Math.sign(target - current) * Math.max(0, maxDelta);
    }

    /** 三维向量按最大距离移动，结果写入 out，并保证不会越过目标点。 */
    public static moveTowardsVec3(current: IVec3, target: IVec3, maxDistanceDelta: number, out: Vec3): Vec3 {
        const x = target.x - current.x;
        const y = target.y - current.y;
        const z = target.z - current.z;
        const distanceSquared = x * x + y * y + z * z;
        const maxDistance = Math.max(0, maxDistanceDelta);

        if (distanceSquared <= maxDistance * maxDistance || distanceSquared <= math.EPSILON * math.EPSILON) {
            return out.set(target.x, target.y, target.z);
        }

        const scale = maxDistance / Math.sqrt(distanceSquared);
        return out.set(
            current.x + x * scale,
            current.y + y * scale,
            current.z + z * scale
        );
    }

    /** 判断两个浮点数是否在误差范围内相等。 */
    public static approximately(a: number, b: number, epsilon: number = math.EPSILON): boolean {
        return Math.abs(a - b) <= Math.abs(epsilon);
    }

    public static degToRad(degrees: number): number {
        return degrees * Math.PI / 180;
    }

    public static radToDeg(radians: number): number {
        return radians * 180 / Math.PI;
    }

    /** 返回两个角度之间的最短有符号差值，结果范围为 [-180, 180)。 */
    public static deltaAngle(current: number, target: number): number {
        return MathUtil.repeat(target - current + 180, 360) - 180;
    }

    /** 角度按最短路径移动。 */
    public static moveTowardsAngle(current: number, target: number, maxDelta: number): number {
        const delta = MathUtil.deltaAngle(current, target);
        if (Math.abs(delta) <= Math.max(0, maxDelta)) return target;
        return current + Math.sign(delta) * Math.max(0, maxDelta);
    }
    /**
     * 计算二阶贝塞尔曲线上的点
     * @param t 时间参数 (0-1)
     * @param point1 起点
     * @param controlPoint 控制点
     * @param point2 终点
     * @param out 输出点
     */
    public static bezierCurve(t: number, point1: Vec3, controlPoint: Vec3, point2: Vec3, out: Vec3): void {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;

        out.set(
            uu * point1.x + 2 * u * t * controlPoint.x + tt * point2.x,
            uu * point1.y + 2 * u * t * controlPoint.y + tt * point2.y,
            uu * point1.z + 2 * u * t * controlPoint.z + tt * point2.z
        );
    }

    /** 获取二阶贝塞尔曲线在 t 处的切线方向，结果写入 out。 */
    public static bezierTangent(t: number, point1: Vec3, controlPoint: Vec3, point2: Vec3, out: Vec3): void {
        const oneMinusT = 1 - t;
        out.set(
            2 * (oneMinusT * (controlPoint.x - point1.x) + t * (point2.x - controlPoint.x)),
            2 * (oneMinusT * (controlPoint.y - point1.y) + t * (point2.y - controlPoint.y)),
            2 * (oneMinusT * (controlPoint.z - point1.z) + t * (point2.z - controlPoint.z))
        );
    }

    /**
     * 计算三阶贝塞尔曲线上的点
     * @param t 时间参数 (0-1)
     * @param point1 起点
     * @param controlPoint1 第一个控制点
     * @param controlPoint2 第二个控制点
     * @param point2 终点
     * @param out 输出点
     */
    public static cubicBezierCurve(t: number, point1: Vec3, controlPoint1: Vec3, controlPoint2: Vec3, point2: Vec3, out: Vec3): void {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const ttt = tt * t;
        const uuu = uu * u;

        out.set(
            uuu * point1.x + 3 * uu * t * controlPoint1.x + 3 * u * tt * controlPoint2.x + ttt * point2.x,
            uuu * point1.y + 3 * uu * t * controlPoint1.y + 3 * u * tt * controlPoint2.y + ttt * point2.y,
            uuu * point1.z + 3 * uu * t * controlPoint1.z + 3 * u * tt * controlPoint2.z + ttt * point2.z
        );
    }

    /** 获取三阶贝塞尔曲线在 t 处的切线方向，结果写入 out。 */
    public static cubicBezierTangent(t: number, point1: Vec3, controlPoint1: Vec3, controlPoint2: Vec3, point2: Vec3, out: Vec3): void {
        const u = 1 - t;
        const uu = u * u;
        const tt = t * t;
        out.set(
            3 * uu * (controlPoint1.x - point1.x) + 6 * u * t * (controlPoint2.x - controlPoint1.x) + 3 * tt * (point2.x - controlPoint2.x),
            3 * uu * (controlPoint1.y - point1.y) + 6 * u * t * (controlPoint2.y - controlPoint1.y) + 3 * tt * (point2.y - controlPoint2.y),
            3 * uu * (controlPoint1.z - point1.z) + 6 * u * t * (controlPoint2.z - controlPoint1.z) + 3 * tt * (point2.z - controlPoint2.z)
        );
    }
}

