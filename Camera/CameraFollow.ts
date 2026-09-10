import { _decorator, CCFloat, Component, Node, Vec3 } from 'cc';
import { GlobalPool } from '../Global/GlobalPool';
const { ccclass, property, disallowMultiple } = _decorator;

@ccclass('CameraFollow')
@disallowMultiple(true)
export class CameraFollow extends Component {

    @property({ type: Node, tooltip: '跟随目标' })
    public target: Node;

    @property({ tooltip: '是否开启目标跟随' })
    public enableFollow: boolean = true;

    @property({ tooltip: '跟随目标的相对偏移量 (世界坐标系)' })
    public followOffset: Vec3 = new Vec3(0, 0, 0);

    @property({ tooltip: '是否启用平滑插值跟随' })
    public smoothFollow: boolean = true;

    @property({ type: CCFloat, min: 0.1, tooltip: '平滑跟随速度，数值越大跟随响应越快' })
    public followSpeed: number = 8;

    @property({ tooltip: '跟随轴向权重（1 为跟随，0 为忽略该轴），例如 (1, 0, 1) 表示不跟随 Y 轴跳跃' })
    public followAxes: Vec3 = new Vec3(1, 1, 1);

    @property({ tooltip: '跟随时是否始终朝向目标' })
    public lookAtTarget: boolean = false;

    protected lateUpdate(deltaTime: number) {
        if (this.enableFollow && this.target && this.target.isValid) {
            this.updateFollow(deltaTime);
        }
    }

    /**
    * 更新摄像机跟随目标的坐标
    */
    private updateFollow(dt: number): void {
        const targetWorldPos = this.target.worldPosition;

        const tempVec3_A = GlobalPool.Vec3Pool.alloc();

        // 计算目标期望的世界坐标：目标位置 + 轴向权重过滤后的偏移
        tempVec3_A.x = targetWorldPos.x * this.followAxes.x + this.followOffset.x;
        tempVec3_A.y = targetWorldPos.y * this.followAxes.y + this.followOffset.y;
        tempVec3_A.z = targetWorldPos.z * this.followAxes.z + this.followOffset.z;

        // 如果未包含的轴向，保持当前摄像机自身坐标
        const currentPos = this.node.worldPosition;
        if (this.followAxes.x === 0) tempVec3_A.x = currentPos.x;
        if (this.followAxes.y === 0) tempVec3_A.y = currentPos.y;
        if (this.followAxes.z === 0) tempVec3_A.z = currentPos.z;

        if (this.smoothFollow) {
            // 平滑插值更新
            const tempVec3_B = GlobalPool.Vec3Pool.alloc();
            const factor = Math.min(1.0, this.followSpeed * dt);
            Vec3.lerp(tempVec3_B, currentPos, tempVec3_A, factor);
            this.node.setWorldPosition(tempVec3_B);
            GlobalPool.Vec3Pool.free(tempVec3_B);
        } else {
            // 硬跟随
            this.node.setWorldPosition(tempVec3_A);
        }

        // 注视目标
        if (this.lookAtTarget) {
            this.node.lookAt(targetWorldPos);
        }

        GlobalPool.Vec3Pool.free(tempVec3_A);
    }

}


