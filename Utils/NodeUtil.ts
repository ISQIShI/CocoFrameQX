import { Vec3, Quat, Node, IVec3 } from "cc";

export class NodeUtil {

    private static readonly _currentPos: Vec3 = new Vec3(); // 当前坐标缓存

    private static readonly _direction: Vec3 = new Vec3(); // 方向向量缓存

    /**
     * 移动到目标坐标
     * @param targetPos 目标坐标
     * @param moveSpeed 移动速度
     * @param targetNode 目标节点
     */
    public static moveToPos(deltaTime: number, targetPos: IVec3, moveSpeed: number, targetNode: Node): boolean {
        targetNode.getWorldPosition(this._currentPos);
        this._direction.set(
            targetPos.x - this._currentPos.x,
            0,
            targetPos.z - this._currentPos.z
        );

        const remainingDistance = this._direction.length();
        const moveDistance = moveSpeed * deltaTime;

        if (remainingDistance <= moveDistance) {
            targetNode.setWorldPosition(targetPos.x, this._currentPos.y, targetPos.z);
            this.lookAtDir(this._direction, targetNode);
            return true;
        }
        else {
            this._direction.normalize().multiplyScalar(moveDistance);
            this._currentPos.add(this._direction);
            targetNode.setWorldPosition(this._currentPos);
            this.lookAtDir(this._direction, targetNode);
            return false;
        }
    }

    private static readonly _tempQuat: Quat = new Quat(); // 临时四元数

    private static readonly _tempVec3: Vec3 = new Vec3(); // 临时向量

    /**
     * 让角色朝向目标位置(仅在 y 轴旋转)
     * 模型朝向是 z 轴正方向
     * @param targetPos 目标位置(世界坐标系)
     * @param targetNode 目标节点
     */
    public static lookAtPos(targetPos: IVec3, targetNode: Node) {
        const currentPos = targetNode.worldPosition;
        // 计算 XZ 平面上的方向向量
        this._tempVec3.x = targetPos.x - currentPos.x;
        this._tempVec3.y = 0;
        this._tempVec3.z = targetPos.z - currentPos.z;
        // 距离极近或原地时直接返回，防止 NaN
        if (this._tempVec3.lengthSqr() < 1e-6) {
            return;
        }
        this.lookAtDir(this._tempVec3, targetNode);
    }

    /**
     * 让角色朝向目标方向(仅在 y 轴旋转)
     * 模型朝向是 z 轴正方向
     * @param direction 目标方向(世界坐标系)
     */
    public static lookAtDir(direction: IVec3, targetNode: Node) {
        const dx = direction.x;
        const dz = direction.z;
        // 原地/零向量保护
        if (dx === 0 && dz === 0) {
            return;
        }
        // 模型朝向为 +Z 轴：
        // dx=0, dz=1 (正前) -> atan2(0, 1) = 0 rad
        // dx=1, dz=0 (正右) -> atan2(1, 0) = PI/2 (顺时针转90度)
        const rad = Math.atan2(dx, dz);
        // 绕 Y 轴生成四元数
        Quat.fromAxisAngle(this._tempQuat, Vec3.UNIT_Y, rad);
        targetNode.setWorldRotation(this._tempQuat);
    }
}


