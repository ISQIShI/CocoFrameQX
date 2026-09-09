import {
    _decorator,
    Component,
    Node,
    Camera,
    Vec3,
    Vec2,
    Quat,
    math,
    clamp,
    tween,
    Tween,
    CCFloat,
    CCBoolean,
    EventTouch,
    EventMouse,
    Input,
    input,
    screen,
} from 'cc';

const { ccclass, property, menu } = _decorator;

/**
 * 震屏预设类型
 */
export type CameraShakePresetType = 'light' | 'medium' | 'heavy' | 'explosion';

/**
 * 通用完善的 3D / 2.5D / 2D 摄像机控制器
 * 提供平滑跟随、平移移动、拉近拉远、旋转视角、注视聚焦、打击震屏以及手势交互等完整常用功能。
 */
@ccclass('CameraController')
@menu('Camera/CameraController')
export class CameraController extends Component {

    // =========================================================================
    // 属性面板配置 (Inspector Properties)
    // =========================================================================

    @property({ type: Camera, tooltip: '受控制的摄像机组件，若为空则在加载时自动获取自身节点上的 Camera' })
    public camera: Camera | null = null;

    @property({ type: Node, tooltip: '摄像机跟随的目标节点（如主角）' })
    public target: Node | null = null;

    // --- 跟随设置 ---
    @property({ group: { name: '跟随设置', id: '1' }, tooltip: '是否开启目标跟随' })
    public enableFollow: boolean = true;

    @property({ group: { name: '跟随设置', id: '1' }, tooltip: '跟随目标的相对偏移量 (世界坐标系)' })
    public followOffset: Vec3 = new Vec3(0, 0, 0);

    @property({ group: { name: '跟随设置', id: '1' }, tooltip: '是否启用平滑跟随插值' })
    public smoothFollow: boolean = true;

    @property({ group: { name: '跟随设置', id: '1' }, type: CCFloat, min: 0.1, tooltip: '平滑跟随速度，数值越大跟随响应越快' })
    public followSpeed: number = 8;

    @property({ group: { name: '跟随设置', id: '1' }, tooltip: '跟随轴向权重（1 为跟随，0 为忽略该轴），例如 (1, 0, 1) 表示不跟随 Y 轴跳跃' })
    public followAxes: Vec3 = new Vec3(1, 1, 1);

    @property({ group: { name: '跟随设置', id: '1' }, tooltip: '跟随时是否始终朝向目标' })
    public lookAtTarget: boolean = false;

    // --- 缩放 / 拉近拉远设置 ---
    @property({ group: { name: '缩放设置', id: '2' }, type: CCFloat, min: 0.1, tooltip: '最小缩放值 (正交模式为 orthoHeight 下限，透视模式为 FOV 或距离下限)' })
    public minZoom: number = 1.0;

    @property({ group: { name: '缩放设置', id: '2' }, type: CCFloat, min: 0.1, tooltip: '最大缩放值 (正交模式为 orthoHeight 上限，透视模式为 FOV 或距离上限)' })
    public maxZoom: number = 10.0;

    @property({ group: { name: '缩放设置', id: '2' }, type: CCFloat, min: 0.1, tooltip: '缩放平滑插值速度' })
    public zoomSpeed: number = 6;

    // --- 边界限制设置 ---
    @property({ group: { name: '边界限制', id: '3' }, tooltip: '是否开启摄像机移动的世界坐标范围边界限制' })
    public enableBounding: boolean = false;

    @property({ group: { name: '边界限制', id: '3' }, tooltip: '世界坐标轴最小边界 (X, Y, Z)' })
    public minBoundary: Vec3 = new Vec3(-50, -50, -50);

    @property({ group: { name: '边界限制', id: '3' }, tooltip: '世界坐标轴最大边界 (X, Y, Z)' })
    public maxBoundary: Vec3 = new Vec3(50, 50, 50);

    // --- 手势 / 鼠标交互控制 (默认关闭，避免与游戏内摇杆拖拽冲突) ---
    @property({ group: { name: '交互控制', id: '4' }, tooltip: '是否启用屏幕触摸/鼠标交互手势控制摄像机' })
    public enableTouchControl: boolean = false;

    @property({ group: { name: '交互控制', id: '4' }, tooltip: '是否允许单指/鼠标拖拽平移视口' })
    public enableTouchPan: boolean = true;

    @property({ group: { name: '交互控制', id: '4' }, tooltip: '是否允许双指捏合 / 鼠标滚轮缩放' })
    public enableWheelZoom: boolean = true;

    @property({ group: { name: '交互控制', id: '4' }, type: CCFloat, min: 0.001, tooltip: '平移拖拽灵敏度' })
    public panSpeed: number = 0.01;

    @property({ group: { name: '交互控制', id: '4' }, type: CCFloat, min: 0.001, tooltip: '滚轮/双指缩放灵敏度' })
    public wheelZoomSpeed: number = 0.5;

    // =========================================================================
    // 内部状态与运行时变量
    // =========================================================================

    // 初始状态快照
    private _initialPosition: Vec3 = new Vec3();
    private _initialEuler: Vec3 = new Vec3();
    private _initialZoom: number = 3.5;

    // 当前目标缩放值（用于平滑过渡）
    private _targetZoom: number = 3.5;
    private _currentZoom: number = 3.5;

    // 震屏参数
    private _isShaking: boolean = false;
    private _shakeDuration: number = 0;
    private _shakeTimer: number = 0;
    private _shakeIntensity: number = 0;
    private _shakeDecay: boolean = true;
    private _shakeOffset: Vec3 = new Vec3();

    // 缓动动画引用（用于打断管理）
    private _moveTween: Tween<Node> | null = null;
    private _rotateTween: Tween<Node> | null = null;
    private _zoomTween: Tween<{ zoom: number }> | null = null;

    // 触摸/手势状态
    private _touches: Map<number, Vec2> = new Map();
    private _touchStartDist: number = 0;
    private _zoomOnTouchStart: number = 0;
    private _isDraggingPan: boolean = false;
    private _lastTouchPos: Vec2 = new Vec2();

    // 临时复用容器（避免 LateUpdate/Update 中频繁 new 对象产生 GC 垃圾）
    private readonly _tempVec3_A: Vec3 = new Vec3();
    private readonly _tempVec3_B: Vec3 = new Vec3();
    private readonly _tempVec3_C: Vec3 = new Vec3();
    private readonly _tempQuat: Quat = new Quat();

    // =========================================================================
    // 状态查询器 (Getters)
    // =========================================================================

    /** 是否正在震屏中 */
    public get isShaking(): boolean { return this._isShaking; }
    /** 是否正在执行移动缓动动画 */
    public get isMoving(): boolean { return this._moveTween !== null; }
    /** 是否正在执行旋转缓动动画 */
    public get isRotating(): boolean { return this._rotateTween !== null; }
    /** 是否正在执行缩放缓动动画 */
    public get isZooming(): boolean { return this._zoomTween !== null; }
    /** 当前是否为正交投影模式 */
    public get isOrtho(): boolean {
        if (!this.camera) return false;
        return this.camera.projection === Camera.ProjectionType.ORTHO;
    }

    // =========================================================================
    // 生命周期 (Lifecycle)
    // =========================================================================

    protected onLoad(): void {
        if (!this.camera) {
            this.camera = this.getComponent(Camera);
        }

        this.recordInitialState();
        this._currentZoom = this.getZoom();
        this._targetZoom = this._currentZoom;
    }

    protected onEnable(): void {
        if (this.enableTouchControl) {
            this.bindInputEvents();
        }
    }

    protected onDisable(): void {
        this.unbindInputEvents();
        this.stopAll();
    }

    /**
     * 摄像机跟随必须在 lateUpdate 中执行
     * 确保所有角色的移动（通常在 update 中）计算完成后再更新摄像机，防止画面抖动撕裂
     */
    protected lateUpdate(dt: number): void {
        // 1. 处理目标跟随逻辑（当没有在执行强制 move 缓动且跟随开启时）
        if (this.enableFollow && this.target && this.target.isValid && !this._moveTween) {
            this.updateFollow(dt);
        }

        // 2. 处理平滑缩放逻辑（当没有在执行 zoom 缓动时）
        if (!this._zoomTween && Math.abs(this._currentZoom - this._targetZoom) > 0.001) {
            const t = Math.min(1.0, this.zoomSpeed * dt);
            this._currentZoom = math.lerp(this._currentZoom, this._targetZoom, t);
            this.applyZoom(this._currentZoom);
        }

        // 3. 处理震屏逻辑并应用最终位置偏移
        if (this._isShaking) {
            this.updateShake(dt);
        }

        // 4. 边界范围限制
        if (this.enableBounding) {
            this.clampBoundary();
        }
    }

    // =========================================================================
    // 摄像机移动与平移 API (Move & Pan)
    // =========================================================================

    /**
     * 平滑移动摄像机到指定世界坐标
     * @param targetPos 目标世界坐标
     * @param duration 移动时长（秒），0 表示瞬间移动
     * @param onComplete 完成回调
     * @returns Tween 动画实例
     */
    public moveTo(targetPos: Vec3, duration: number = 0.5, onComplete?: () => void): Tween<Node> | null {
        this.stopMove();

        if (duration <= 0) {
            this.node.setWorldPosition(targetPos);
            onComplete?.();
            return null;
        }

        const startPos = this.node.worldPosition.clone();
        const destPos = targetPos.clone();

        // 限制在边界内
        if (this.enableBounding) {
            destPos.x = clamp(destPos.x, this.minBoundary.x, this.maxBoundary.x);
            destPos.y = clamp(destPos.y, this.minBoundary.y, this.maxBoundary.y);
            destPos.z = clamp(destPos.z, this.minBoundary.z, this.maxBoundary.z);
        }

        const twObj = { t: 0 };
        this._moveTween = tween(this.node)
            .to(duration, {}, {
                onUpdate: (_target: Node, ratio: number) => {
                    Vec3.lerp(this._tempVec3_A, startPos, destPos, ratio);
                    this.node.setWorldPosition(this._tempVec3_A);
                }
            })
            .call(() => {
                this._moveTween = null;
                onComplete?.();
            })
            .start();

        return this._moveTween;
    }

    /**
     * 相对当前位置平滑偏移移动
     * @param offset 偏移量
     * @param duration 移动时长（秒）
     * @param onComplete 完成回调
     */
    public moveBy(offset: Vec3, duration: number = 0.5, onComplete?: () => void): Tween<Node> | null {
        Vec3.add(this._tempVec3_A, this.node.worldPosition, offset);
        return this.moveTo(this._tempVec3_A, duration, onComplete);
    }

    /**
     * 瞬间设置摄像机世界坐标
     * @param pos 世界坐标
     */
    public setWorldPosition(pos: Vec3): void {
        this.stopMove();
        this.node.setWorldPosition(pos);
        if (this.enableBounding) {
            this.clampBoundary();
        }
    }

    /**
     * 获取摄像机当前世界坐标
     * @param out 可选输出容器
     */
    public getWorldPosition(out?: Vec3): Vec3 {
        const result = out || new Vec3();
        result.set(this.node.worldPosition);
        return result;
    }

    /**
     * 停止当前正在进行的移动缓动
     */
    public stopMove(): void {
        if (this._moveTween) {
            this._moveTween.stop();
            this._moveTween = null;
        }
    }

    // =========================================================================
    // 摄像机缩放 / 拉近拉远 API (Zoom In / Out)
    // =========================================================================

    /**
     * 平滑缩放到指定数值
     * 正交模式对应 orthoHeight；透视模式对应 FOV（或相对距离）
     * @param targetZoom 目标缩放值（越小越拉近，越大越拉远）
     * @param duration 过渡时长（秒），0 表示立即设置
     * @param onComplete 完成回调
     */
    public zoomTo(targetZoom: number, duration: number = 0.5, onComplete?: () => void): void {
        this.stopZoom();
        const clampedZoom = clamp(targetZoom, this.minZoom, this.maxZoom);

        if (duration <= 0) {
            this.setZoom(clampedZoom);
            onComplete?.();
            return;
        }

        const startZoom = this.getZoom();
        const zoomObj = { zoom: startZoom };

        this._zoomTween = tween(zoomObj)
            .to(duration, { zoom: clampedZoom }, {
                onUpdate: () => {
                    this._currentZoom = zoomObj.zoom;
                    this._targetZoom = zoomObj.zoom;
                    this.applyZoom(zoomObj.zoom);
                }
            })
            .call(() => {
                this._zoomTween = null;
                onComplete?.();
            })
            .start();
    }

    /**
     * 增量平滑拉近/拉远
     * @param delta 变化量（负值拉近，正值拉远）
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public zoomBy(delta: number, duration: number = 0.5, onComplete?: () => void): void {
        const current = this.getZoom();
        this.zoomTo(current + delta, duration, onComplete);
    }

    /**
     * 瞬间设置缩放值
     * @param zoom 缩放数值
     */
    public setZoom(zoom: number): void {
        this.stopZoom();
        const clamped = clamp(zoom, this.minZoom, this.maxZoom);
        this._currentZoom = clamped;
        this._targetZoom = clamped;
        this.applyZoom(clamped);
    }

    /**
     * 获取当前摄像机缩放值
     */
    public getZoom(): number {
        if (!this.camera) {
            return this._currentZoom;
        }
        if (this.isOrtho) {
            return this.camera.orthoHeight;
        } else {
            return this.camera.fov;
        }
    }

    /**
     * 快速设置缩放目标（由 lateUpdate 自动平滑追赶）
     * @param targetZoom 目标缩放值
     */
    public setTargetZoom(targetZoom: number): void {
        this._targetZoom = clamp(targetZoom, this.minZoom, this.maxZoom);
    }

    /**
     * 停止当前缩放动画
     */
    public stopZoom(): void {
        if (this._zoomTween) {
            this._zoomTween.stop();
            this._zoomTween = null;
        }
    }

    // =========================================================================
    // 摄像机旋转与朝向 API (Rotate & LookAt)
    // =========================================================================

    /**
     * 平滑朝向指定世界坐标点
     * @param targetPos 目标世界坐标
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public lookAt(targetPos: Vec3, duration: number = 0.5, onComplete?: () => void): Tween<Node> | null {
        this.stopRotate();

        // 计算朝向目标位置所需的旋转四元数
        Vec3.subtract(this._tempVec3_A, targetPos, this.node.worldPosition);
        if (this._tempVec3_A.lengthSqr() < 1e-6) {
            onComplete?.();
            return null;
        }

        // 使用当前节点的朝向计算
        Quat.fromViewUp(this._tempQuat, this._tempVec3_A.normalize(), Vec3.UNIT_Y);

        if (duration <= 0) {
            this.node.setWorldRotation(this._tempQuat);
            onComplete?.();
            return null;
        }

        const startRot = this.node.worldRotation.clone();
        const endRot = this._tempQuat.clone();

        this._rotateTween = tween(this.node)
            .to(duration, {}, {
                onUpdate: (_target: Node, ratio: number) => {
                    Quat.slerp(this._tempQuat, startRot, endRot, ratio);
                    this.node.setWorldRotation(this._tempQuat);
                }
            })
            .call(() => {
                this._rotateTween = null;
                onComplete?.();
            })
            .start();

        return this._rotateTween;
    }

    /**
     * 平滑旋转到指定的欧拉角
     * @param euler 目标欧拉角 (度数)
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public rotateTo(euler: Vec3, duration: number = 0.5, onComplete?: () => void): Tween<Node> | null {
        this.stopRotate();

        Quat.fromEuler(this._tempQuat, euler.x, euler.y, euler.z);

        if (duration <= 0) {
            this.node.setWorldRotation(this._tempQuat);
            onComplete?.();
            return null;
        }

        const startRot = this.node.worldRotation.clone();
        const endRot = this._tempQuat.clone();

        this._rotateTween = tween(this.node)
            .to(duration, {}, {
                onUpdate: (_target: Node, ratio: number) => {
                    Quat.slerp(this._tempQuat, startRot, endRot, ratio);
                    this.node.setWorldRotation(this._tempQuat);
                }
            })
            .call(() => {
                this._rotateTween = null;
                onComplete?.();
            })
            .start();

        return this._rotateTween;
    }

    /**
     * 相对当前旋转增量旋转
     * @param eulerDelta 欧拉角增量
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public rotateBy(eulerDelta: Vec3, duration: number = 0.5, onComplete?: () => void): Tween<Node> | null {
        const curEuler = this.getEulerAngles(this._tempVec3_B);
        Vec3.add(this._tempVec3_A, curEuler, eulerDelta);
        return this.rotateTo(this._tempVec3_A, duration, onComplete);
    }

    /**
     * 瞬间设置欧拉角
     * @param euler 欧拉角
     */
    public setEulerAngles(euler: Vec3): void {
        this.stopRotate();
        this.node.setRotationFromEuler(euler);
    }

    /**
     * 获取摄像机当前的欧拉角
     * @param out 可选输出容器
     */
    public getEulerAngles(out?: Vec3): Vec3 {
        const result = out || new Vec3();
        result.set(this.node.eulerAngles);
        return result;
    }

    /**
     * 停止当前旋转动画
     */
    public stopRotate(): void {
        if (this._rotateTween) {
            this._rotateTween.stop();
            this._rotateTween = null;
        }
    }

    // =========================================================================
    // 聚焦与特写 API (Focus & Reset)
    // =========================================================================

    /**
     * 聚焦/特写到指定节点或世界坐标点
     * @param target 目标节点或世界坐标
     * @param duration 过渡时长（秒）
     * @param zoom 聚焦时的缩放值（可选）
     * @param onComplete 完成回调
     */
    public focusOn(
        target: Node | Vec3,
        duration: number = 0.8,
        zoom?: number,
        onComplete?: () => void
    ): void {
        let destPos: Vec3;
        if (target instanceof Node) {
            destPos = target.worldPosition.clone().add(this.followOffset);
        } else {
            destPos = target.clone().add(this.followOffset);
        }

        let completedCount = 0;
        const totalTasks = zoom !== undefined ? 2 : 1;
        const checkDone = () => {
            completedCount++;
            if (completedCount >= totalTasks) {
                onComplete?.();
            }
        };

        this.moveTo(destPos, duration, checkDone);

        if (zoom !== undefined) {
            this.zoomTo(zoom, duration, checkDone);
        }
    }

    /**
     * 记录当前状态作为初始状态快照
     */
    public recordInitialState(): void {
        this._initialPosition.set(this.node.worldPosition);
        this._initialEuler.set(this.node.eulerAngles);
        this._initialZoom = this.getZoom();
    }

    /**
     * 复位到记录的初始位置、角度和缩放
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public resetToInitial(duration: number = 0.6, onComplete?: () => void): void {
        let completedCount = 0;
        const totalTasks = 3;
        const checkDone = () => {
            completedCount++;
            if (completedCount >= totalTasks) {
                onComplete?.();
            }
        };

        this.moveTo(this._initialPosition, duration, checkDone);
        this.rotateTo(this._initialEuler, duration, checkDone);
        this.zoomTo(this._initialZoom, duration, checkDone);
    }

    // =========================================================================
    // 摄像机震屏系统 (Camera Shake)
    // =========================================================================

    /**
     * 触发摄像机震屏（受击、爆炸、打击感）
     * @param duration 震动持续时间（秒）
     * @param intensity 震动强度幅度（像素/世界距离）
     * @param decay 是否随时间衰减震动强度，默认 true
     */
    public shake(duration: number = 0.3, intensity: number = 0.2, decay: boolean = true): void {
        this._isShaking = true;
        this._shakeDuration = Math.max(duration, 0.05);
        this._shakeTimer = this._shakeDuration;
        this._shakeIntensity = intensity;
        this._shakeDecay = decay;
        this._shakeOffset.set(0, 0, 0);
    }

    /**
     * 使用常用预设快速触发震屏
     * @param type 预设类型：'light' (轻微) | 'medium' (中度) | 'heavy' (重度) | 'explosion' (爆炸)
     */
    public shakePreset(type: CameraShakePresetType = 'medium'): void {
        switch (type) {
            case 'light':
                this.shake(0.15, 0.08, true);
                break;
            case 'medium':
                this.shake(0.25, 0.18, true);
                break;
            case 'heavy':
                this.shake(0.4, 0.35, true);
                break;
            case 'explosion':
                this.shake(0.6, 0.55, true);
                break;
        }
    }

    /**
     * 立即停止震屏
     */
    public stopShake(): void {
        if (this._isShaking) {
            // 恢复震屏前的位置偏移
            Vec3.subtract(this._tempVec3_A, this.node.worldPosition, this._shakeOffset);
            this.node.setWorldPosition(this._tempVec3_A);
        }
        this._isShaking = false;
        this._shakeOffset.set(0, 0, 0);
    }

    // =========================================================================
    // 跟随目标控制 API (Target Following)
    // =========================================================================

    /**
     * 动态设置跟随的目标节点
     * @param target 目标节点，传 null 可取消跟随
     * @param offset 可选的新跟随相对偏移量
     */
    public setTarget(target: Node | null, offset?: Vec3): void {
        this.target = target;
        if (offset) {
            this.followOffset.set(offset);
        }
    }

    /**
     * 获取当前跟随的目标节点
     */
    public getTarget(): Node | null {
        return this.target;
    }

    /**
     * 动态平滑改变跟随偏移量
     * @param offset 新的偏移量
     * @param duration 过渡时长（秒）
     * @param onComplete 完成回调
     */
    public setFollowOffset(offset: Vec3, duration: number = 0, onComplete?: () => void): void {
        if (duration <= 0) {
            this.followOffset.set(offset);
            onComplete?.();
            return;
        }

        const startOffset = this.followOffset.clone();
        const endOffset = offset.clone();

        const offsetObj = { t: 0 };
        tween(offsetObj)
            .to(duration, { t: 1 }, {
                onUpdate: () => {
                    Vec3.lerp(this.followOffset, startOffset, endOffset, offsetObj.t);
                }
            })
            .call(() => {
                this.followOffset.set(endOffset);
                onComplete?.();
            })
            .start();
    }

    /**
     * 停止所有正在执行的缓动、旋转、缩放与震屏
     */
    public stopAll(): void {
        this.stopMove();
        this.stopRotate();
        this.stopZoom();
        this.stopShake();
    }

    // =========================================================================
    // 内部实现逻辑 (Private Helper Methods)
    // =========================================================================

    /**
     * 更新摄像机跟随目标的坐标
     */
    private updateFollow(dt: number): void {
        if (!this.target) return;

        const targetWorldPos = this.target.worldPosition;

        // 计算目标期望的世界坐标：目标位置 + 轴向权重过滤后的偏移
        this._tempVec3_A.x = targetWorldPos.x * this.followAxes.x + this.followOffset.x;
        this._tempVec3_A.y = targetWorldPos.y * this.followAxes.y + this.followOffset.y;
        this._tempVec3_A.z = targetWorldPos.z * this.followAxes.z + this.followOffset.z;

        // 如果未包含的轴向，保持当前摄像机自身坐标
        const currentPos = this.node.worldPosition;
        if (this.followAxes.x === 0) this._tempVec3_A.x = currentPos.x;
        if (this.followAxes.y === 0) this._tempVec3_A.y = currentPos.y;
        if (this.followAxes.z === 0) this._tempVec3_A.z = currentPos.z;

        if (this.smoothFollow) {
            // 平滑插值更新
            const factor = Math.min(1.0, this.followSpeed * dt);
            Vec3.lerp(this._tempVec3_B, currentPos, this._tempVec3_A, factor);
            this.node.setWorldPosition(this._tempVec3_B);
        } else {
            // 硬跟随
            this.node.setWorldPosition(this._tempVec3_A);
        }

        // 注视目标
        if (this.lookAtTarget) {
            this.node.lookAt(targetWorldPos);
        }
    }

    /**
     * 应用缩放到摄像机属性
     */
    private applyZoom(zoom: number): void {
        if (!this.camera) return;
        if (this.isOrtho) {
            this.camera.orthoHeight = zoom;
        } else {
            this.camera.fov = zoom;
        }
    }

    /**
     * 更新震屏位移
     */
    private updateShake(dt: number): void {
        this._shakeTimer -= dt;
        if (this._shakeTimer <= 0) {
            this.stopShake();
            return;
        }

        // 还原上一次震动的临时偏移
        Vec3.subtract(this._tempVec3_A, this.node.worldPosition, this._shakeOffset);

        // 计算当前震动强度
        let currentIntensity = this._shakeIntensity;
        if (this._shakeDecay) {
            const progress = this._shakeTimer / this._shakeDuration; // 1 -> 0
            currentIntensity *= progress;
        }

        // 生成随机扰动偏移
        this._shakeOffset.x = (Math.random() * 2 - 1) * currentIntensity;
        this._shakeOffset.y = (Math.random() * 2 - 1) * currentIntensity;
        this._shakeOffset.z = (Math.random() * 2 - 1) * currentIntensity;

        // 应用新偏移
        Vec3.add(this._tempVec3_A, this._tempVec3_A, this._shakeOffset);
        this.node.setWorldPosition(this._tempVec3_A);
    }

    /**
     * 约束摄像机位置在边界内
     */
    private clampBoundary(): void {
        const pos = this.node.worldPosition;
        const clampedX = clamp(pos.x, this.minBoundary.x, this.maxBoundary.x);
        const clampedY = clamp(pos.y, this.minBoundary.y, this.maxBoundary.y);
        const clampedZ = clamp(pos.z, this.minBoundary.z, this.maxBoundary.z);

        if (pos.x !== clampedX || pos.y !== clampedY || pos.z !== clampedZ) {
            this._tempVec3_A.set(clampedX, clampedY, clampedZ);
            this.node.setWorldPosition(this._tempVec3_A);
        }
    }

    // =========================================================================
    // 手势与鼠标交互事件处理 (Touch & Mouse Gestures)
    // =========================================================================

    private bindInputEvents(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    private unbindInputEvents(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    }

    private onTouchStart(event: EventTouch): void {
        if (!this.enableTouchControl) return;

        const touch = event.touch;
        if (!touch) return;

        const loc = touch.getLocation();
        this._touches.set(touch.getID(), new Vec2(loc.x, loc.y));

        if (this._touches.size === 1) {
            // 单指开始拖拽平移
            this._isDraggingPan = true;
            this._lastTouchPos.set(loc.x, loc.y);
        } else if (this._touches.size === 2 && this.enableWheelZoom) {
            // 双指开始捏合缩放
            this._isDraggingPan = false;
            const points: Vec2[] = Array.from(this._touches.values());
            this._touchStartDist = Vec2.distance(points[0], points[1]);
            this._zoomOnTouchStart = this.getZoom();
        }
    }

    private onTouchMove(event: EventTouch): void {
        if (!this.enableTouchControl) return;

        const touch = event.touch;
        if (!touch) return;

        const loc = touch.getLocation();
        this._touches.set(touch.getID(), new Vec2(loc.x, loc.y));

        if (this._touches.size === 1 && this.enableTouchPan && this._isDraggingPan) {
            // 单指拖拽平移摄像机（将屏幕移动量沿摄像机右向量和上/前向量平移）
            const deltaX = loc.x - this._lastTouchPos.x;
            const deltaY = loc.y - this._lastTouchPos.y;
            this._lastTouchPos.set(loc.x, loc.y);

            const camNode = this.node;
            // 沿摄像机右方和前下方移动
            const right = camNode.right.clone().multiplyScalar(-deltaX * this.panSpeed);
            const forward = camNode.up.clone().multiplyScalar(-deltaY * this.panSpeed);

            Vec3.add(this._tempVec3_A, this.node.worldPosition, right);
            Vec3.add(this._tempVec3_A, this._tempVec3_A, forward);
            this.setWorldPosition(this._tempVec3_A);

        } else if (this._touches.size === 2 && this.enableWheelZoom && this._touchStartDist > 0) {
            // 双指捏合缩放
            const points: Vec2[] = Array.from(this._touches.values());
            const currentDist = Vec2.distance(points[0], points[1]);
            const scaleFactor = this._touchStartDist / Math.max(currentDist, 1);
            const targetZoom = this._zoomOnTouchStart * scaleFactor;
            this.setTargetZoom(targetZoom);
        }
    }

    private onTouchEnd(event: EventTouch): void {
        if (!this.enableTouchControl) return;
        const touch = event.touch;
        if (touch) {
            this._touches.delete(touch.getID());
        }
        if (this._touches.size === 0) {
            this._isDraggingPan = false;
            this._touchStartDist = 0;
        } else if (this._touches.size === 1) {
            const remaining = Array.from(this._touches.values())[0];
            this._lastTouchPos.set(remaining.x, remaining.y);
            this._isDraggingPan = true;
        }
    }

    private onTouchCancel(event: EventTouch): void {
        this.onTouchEnd(event);
    }

    private onMouseWheel(event: EventMouse): void {
        if (!this.enableTouchControl || !this.enableWheelZoom) return;
        const scrollY = event.getScrollY();
        if (scrollY !== 0) {
            // 向上滚拉近 (delta < 0)，向下滚拉远 (delta > 0)
            const delta = (scrollY > 0 ? -1 : 1) * this.wheelZoomSpeed;
            this.setTargetZoom(this._targetZoom + delta);
        }
    }
}
