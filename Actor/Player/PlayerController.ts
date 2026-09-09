import { _decorator, Camera, CCFloat, CharacterController, Component, EventTouch, find, Input, input, Quat, Vec2, Vec3 } from 'cc';
import { GlobalPool } from '../../Global/GlobalPool';
import { NodeUtil } from '../../Utils/NodeUtil';

const { ccclass, property } = _decorator;

@ccclass('PlayerController')
export class PlayerController extends Component {

    @property({ type: Camera, tooltip: '主摄像机组件' })
    public mainCamera: Camera = null!;

    @property({ type: CharacterController, tooltip: '角色控制器组件', visible: true })
    private _characterController: CharacterController;

    @property({ tooltip: '触摸死区（像素），低于该偏移量不触发移动' })
    public deadZone: number = 5;

    @property({ tooltip: '最大有效拖拽距离（像素），用于计算归一化输入力度', min: 0 })
    public maxRadius: number = 0;

    @property({ type: CCFloat, min: 0 })
    public moveSpeed: number = 2;

    // 触摸输入状态
    private _isTouchMoving: boolean = false;
    private _touchStartPos: Vec2 = new Vec2();
    private _currentTouchPos: Vec2 = new Vec2();

    // 屏幕输入向量 (x: 左右, y: 上下，范围 -1 ~ 1)
    private _inputVector: Vec2 = new Vec2();

    private _moveDir: Vec3 = new Vec3();

    /**
     * 当前是否处于有效触摸移动状态
     */
    public get isMoving(): boolean {
        return this._isTouchMoving;
    }

    protected onLoad(): void {
        // 若未在属性检查器指定主摄像机，则自动查找场景中的主摄像机
        if (!this.mainCamera) {
            this.mainCamera = find('Main Camera')?.getComponent(Camera)!;
        }
        if (!this.mainCamera) {
            console.warn('PlayerController: 未找到主摄像机，请在属性检查器中手动指定 mainCamera 属性。');
        }
    }

    protected onEnable(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);

        this.node.setRotation(Quat.IDENTITY);
    }

    protected onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.resetTouchState();
    }

    protected update(dt: number): void {
        if (this._isTouchMoving) {
            // 计算目标位置
            // Vec3.scaleAndAdd(this._targetPos, this.node.worldPosition, this._moveDir, this.moveSpeed * dt);
            // this.moveToPos(dt, this._targetPos);
            const tempVec3 = GlobalPool.Vec3Pool.alloc();
            Vec3.multiplyScalar(tempVec3, this._moveDir, this.moveSpeed * dt);
            this._characterController.move(tempVec3);
            NodeUtil.lookAtDir(this._moveDir, this.node);

            GlobalPool.Vec3Pool.free(tempVec3);
        }
    }

    private onTouchStart(event: EventTouch): void {
        // 记录触摸按下时的起始屏幕点
        const loc = event.getUILocation();
        this._touchStartPos.set(loc.x, loc.y);
        this._currentTouchPos.set(loc.x, loc.y);
        this._inputVector.set(0, 0);
        this._isTouchMoving = false;
    }

    private onTouchMove(event: EventTouch): void {
        const loc = event.getUILocation();
        this._currentTouchPos.set(loc.x, loc.y);

        // 计算屏幕滑动偏移量 (UI 坐标系：X 轴向右为正，Y 轴向上为正)
        const offsetX = this._currentTouchPos.x - this._touchStartPos.x;
        const offsetY = this._currentTouchPos.y - this._touchStartPos.y;
        const dist = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

        // 超过死区距离才判定为移动
        if (dist > this.deadZone) {
            this._isTouchMoving = true;
            // 计算输入力度比例 (0 ~ 1) 并归一化方向
            const strength = this.maxRadius > 0 ? Math.min(1.0, dist / this.maxRadius) : 1;
            this._inputVector.set(
                (offsetX / dist) * strength,
                (offsetY / dist) * strength
            );
            // 更新移动方向
            this.calculateMovementDirection();
        } else {
            this._isTouchMoving = false;
            this._inputVector.set(0, 0);
            this._moveDir.set(0, 0, 0);
        }
    }

    private onTouchEnd(event: EventTouch): void {
        this.resetTouchState();
    }

    private onTouchCancel(event: EventTouch): void {
        this.resetTouchState();
    }

    private resetTouchState(): void {
        this._isTouchMoving = false;
        this._inputVector.set(0, 0);
        this._moveDir.set(0, 0, 0);
    }

    /**
    * 获取玩家在 3D 世界空间下的移动方向（已转换并对齐主摄像机视角）
    * 
    * 算法说明：
    * 1. 自行根据触摸滑动的起点与当前点计算出屏幕二维输入向量 (X: 左右, Y: 上下)；
    * 2. 获取主摄像机在世界空间中的 Right (右) 和 Forward (前) 方向向量，自动包含摄像机及其父级节点的旋转、缩放与位移影响；
    * 3. 将摄像机基底向量投影到水平 XZ 平面（剔除 Y 轴分量），并针对垂直俯视视角进行容错；
    * 4. 结合屏幕输入合成 3D 世界移动方向，确保“向屏幕上方拖拽”对应“向摄像机视线深处移动”，“向右拖拽”对应“向摄像机右方移动”。
    */
    private calculateMovementDirection(): void {
        const target = this._moveDir;

        // 获取摄像机节点
        const camNode = this.mainCamera.node;

        // 获取摄像机在世界坐标系下的基底向量
        // 摄像机屏幕“右方”在世界空间的向量
        const camRight = GlobalPool.Vec3Pool.alloc();
        Vec3.transformQuat(camRight, Vec3.RIGHT, camNode.worldRotation);
        // 摄像机屏幕“视线前方(-Z)”在世界空间的向量
        const camForward = GlobalPool.Vec3Pool.alloc();
        Vec3.transformQuat(camForward, Vec3.FORWARD, camNode.worldRotation);

        // 将基底向量投影到水平运动平面 (XZ 平面)
        camRight.y = 0;
        camForward.y = 0;

        // 特殊视角处理：当摄像机垂直正向下俯视（Pitch = -90°）时，Forward 在 XZ 平面投影模长为 0
        if (camForward.lengthSqr() < 0.0001) {
            // 此时屏幕“上方”由摄像机的 Up 向量投影决定
            Vec3.transformQuat(camForward, Vec3.UP, camNode.worldRotation);
            camForward.y = 0;
        }

        // 归一化水平基底向量
        camRight.normalize();
        camForward.normalize();

        // 根据屏幕滑动输入合成 3D 世界移动方向
        // 屏幕滑动 X 轴偏移沿摄像机右方向，Y 轴偏移沿摄像机前视方向
        const dirX = this._inputVector.x;
        const dirY = this._inputVector.y;
        target.x = camRight.x * dirX + camForward.x * dirY;
        target.y = 0;
        target.z = camRight.z * dirX + camForward.z * dirY;

        // 保持与输入力度一致的模长 (0 ~ 1)
        const inputMagnitude = this._inputVector.length();
        target.normalize().multiplyScalar(inputMagnitude);

        // 释放临时 Vec3 对象
        GlobalPool.Vec3Pool.free(camRight);
        GlobalPool.Vec3Pool.free(camForward);
    }
}
