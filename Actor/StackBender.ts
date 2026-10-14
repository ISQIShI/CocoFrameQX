import { _decorator, Component, Node, Vec3, Quat, v3, Vec2 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * ★ StackBender - 通用世界空间堆叠弯曲组件
 *
 * 挂载方式：直接挂在物品容器节点（bagNode）上。
 * 核心原理：通过子节点下标 + childPosY 计算堆叠海拔，越高弯曲越大。
 *
 * ──────────────────── 跨项目使用 ────────────────────
 *   1. 拷贝本文件到目标项目
 *   2. 挂到物品容器节点上
 *   3. 配置弯曲参数
 *   4. 如有飞行中的物品，将它的下标加入 skipIndices
 *   5. 完成
 */
@ccclass('StackBender')
export class StackBender extends Component {

    // ==================== 弯曲参数 ====================

    /** 子物体 Y 轴堆叠间距 */
    @property
    childPosY: number = 0;

    /** 移动时物品最大倾斜角度（度），绕世界 X 轴 */
    @property
    maxInclineAngle: number = 10;

    /** 移动时物品最大 Z 轴推出距离 */
    @property
    maxZOffset: number = 0.2;

    /** 停止后弯曲回直的衰减速度，越大越快 */
    @property
    intensityFallSpeed: number = 5;

    /** 检测移动的最小速度阈值，低于此值视为静止 */
    @property
    moveThreshold: number = 0.5;

    /** 物品回直速度倍率，默认 1，调大加速回直 */
    @property
    recoverSpeed: number = 1;

    /** 背包显示数量 */
    @property
    maxCount: number = 20;

    // ==================== 跳过列表 ====================

    /**
     * 需要跳过的子节点下标集合
     */
    skipIndices: Set<number> = new Set();

    // ==================== 运行时 ====================

    private _bendIntensity: number = 0;
    private _lastNodeWorldPos: Vec3 = new Vec3();
    private _posInited: boolean = false;

    private _lastWorldPos: Map<Node, Vec3> = new Map();
    private _lastWorldRot: Map<Node, Quat> = new Map();
    private _activeItems: Set<Node> = new Set();

    private _tiltQuat: Quat = new Quat();
    private _tmpQ1: Quat = new Quat();
    private _tmpQ2: Quat = new Quat();
    private _restLocalPos: Vec3 = new Vec3();
    private _restWorldPos: Vec3 = new Vec3();


    /** 添加需要跳过的子节点下标到集合中 */
    AddSkipIndices(index: number) {
        this.skipIndices.add(index);
    }

    /** 从集合中移除需要跳过的子节点下标 */
    RemoveSkipIndices(index: number) {
        this.skipIndices.delete(index);
    }

    // ==================== 生命周期 ====================

    onDestroy() {
        this._lastWorldPos.clear();
        this._lastWorldRot.clear();
        this._activeItems.clear();
        this.skipIndices.clear();
    }

    update(dt: number) {
        if (dt <= 0) return;

        const target = this.getSpeedIntensity(dt);

        if (target >= this._bendIntensity) {
            this._bendIntensity = target;
        } else {
            const t = Math.min(1, this.intensityFallSpeed * dt);
            this._bendIntensity += (target - this._bendIntensity) * t;
        }

        if (this._bendIntensity < 0.001) this._bendIntensity = 0;
        if (this._bendIntensity > 0.999) this._bendIntensity = 1;
    }

    lateUpdate() {
        this.followChildren();
    }

    // ==================== 速度检测 ====================

    private getSpeedIntensity(dt: number): number {
        const wp = this.node.worldPosition;

        if (!this._posInited) {
            this._lastNodeWorldPos.set(wp);
            this._posInited = true;
            return 0;
        }

        const dx = wp.x - this._lastNodeWorldPos.x;
        const dy = wp.y - this._lastNodeWorldPos.y;
        const dz = wp.z - this._lastNodeWorldPos.z;
        const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        this._lastNodeWorldPos.set(wp);

        if (speed <= this.moveThreshold) return 0;
        return Math.min(1, (speed - this.moveThreshold) / this.moveThreshold);
    }

    // ==================== 核心：世界空间弯曲 ====================

    private followChildren(): void {
        const intensity = this._bendIntensity;
        const children = this.node.children;
        if (children.length === 0) {
            this._activeItems.clear();
            this.cleanupCache();
            return;
        }

        this._activeItems.clear();

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            // if (child.getComponent(Mu) && child.getComponent(Mu).isready) {
            //     break;
            // }

            if (!child || !child.isValid) continue;
            if (this.skipIndices.has(i)) continue;

            this._activeItems.add(child);

            // 高度比：与 BagBender 完全一致的公式，+2 为底部软启动偏移
            const heightRatio = Math.min((i + 2) / (this.maxCount + 2), 1) * 0.8;
            const curveFactor = Math.pow(heightRatio, 0.4);

            // 目标局部位置：X=0，Y=理论堆叠高度，Z 向后推出
            this._restLocalPos.set(0, this.childPosY * i, 0);
            this._restLocalPos.z -= this.maxZOffset * intensity * curveFactor;

            // 转到世界空间
            Vec3.transformMat4(this._restWorldPos, this._restLocalPos, this.node.worldMatrix);

            // Lerp 平滑
            let lastPos = this._lastWorldPos.get(child);
            if (!lastPos) {
                lastPos = child.worldPosition.clone();
                this._lastWorldPos.set(child, lastPos);
            }
            const lerpFactor = Math.min(1, (1 - curveFactor) * this.recoverSpeed);
            Vec3.lerp(lastPos, lastPos, this._restWorldPos, lerpFactor);
            child.setWorldPosition(lastPos);

            // 目标世界旋转
            const targetAngle = this.maxInclineAngle * intensity * curveFactor;

            // 物品自身的 bagRotationOffset（如瓶子 90° Z）
            const offset = this.getRotationOffset(child);
            Quat.fromEuler(this._tmpQ1, offset.x, offset.y, offset.z);

            // 容器世界朝向 + 物品旋转偏移 + 世界 X 轴倾斜
            Quat.multiply(this._tmpQ2, this.node.worldRotation, this._tmpQ1);
            Quat.fromEuler(this._tiltQuat, -targetAngle, 0, 0);
            Quat.multiply(this._tmpQ1, this._tiltQuat, this._tmpQ2);

            // Slerp 平滑
            let lastRot = this._lastWorldRot.get(child);
            if (!lastRot) {
                lastRot = child.worldRotation.clone();
                this._lastWorldRot.set(child, lastRot);
            }
            Quat.slerp(lastRot, lastRot, this._tmpQ1, lerpFactor);
            child.setWorldRotation(lastRot);
        }

        this.cleanupCache();
    }

    // ==================== 辅助方法 ====================

    private cleanupCache(): void {
        for (const node of this._lastWorldPos.keys()) {
            if (!this._activeItems.has(node)) {
                this._lastWorldPos.delete(node);
                this._lastWorldRot.delete(node);
            }
        }
    }

    /**
     * Duck Typing 方式获取子物体上的 bagRotationOffset
     * 遍历子节点的所有组件，找到包含 bagRotationOffset 属性的组件
     */
    private getRotationOffset(child: Node): Vec3 {
        const comps = (child as any)._components;
        if (!comps) return Vec3.ZERO;
        for (const comp of comps) {
            if (comp && comp.bagRotationOffset) {
                return comp.bagRotationOffset as Vec3;
            }
        }
        return Vec3.ZERO;
    }
}