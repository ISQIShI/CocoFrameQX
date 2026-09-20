import { _decorator, Component, EventTouch, Input, input, Node, UITransform, v3, Vec2, Vec3 } from 'cc';
import { GameManager, IPausable } from '../Global/GameManager';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
const { ccclass, property } = _decorator;

@ccclass('JoyStick')
export class JoyStick extends ComponentSingletonBase implements IPausable {

    @property({ type: Node, tooltip: '摇杆圆点' })
    public pole: Node = null!;

    @property({ type: Node, tooltip: '摇杆底盘' })
    public dish: Node = null!;

    private _maxRadius: number = 60;
    private _uiTransform: UITransform = null!;
    private _parentUITransform: UITransform = null!;

    public get isTouching(): boolean {
        return this.node.active;
    }

    private _inputVector: Vec2 = new Vec2();

    public get inputVector(): Vec2 {
        return this._inputVector;
    }

    public get inputStrength(): number {
        return this._inputVector.length() / this._maxRadius;
    }

    private _tempPos: Vec3 = new Vec3();

    private _onTouchStart: MulticastDelegate<(joyStick: JoyStick) => void>;

    public get onTouchStart(): MulticastDelegate<(joyStick: JoyStick) => void> {
        if (!this._onTouchStart) {
            this._onTouchStart = new MulticastDelegate<(joyStick: JoyStick) => void>();
        }
        return this._onTouchStart;
    }

    private _onTouchMove: MulticastDelegate<(joyStick: JoyStick) => void>;

    public get onTouchMove(): MulticastDelegate<(joyStick: JoyStick) => void> {
        if (!this._onTouchMove) {
            this._onTouchMove = new MulticastDelegate<(joyStick: JoyStick) => void>();
        }
        return this._onTouchMove;
    }

    private _onTouchEnd: MulticastDelegate<(joyStick: JoyStick) => void>;

    public get onTouchEnd(): MulticastDelegate<(joyStick: JoyStick) => void> {
        if (!this._onTouchEnd) {
            this._onTouchEnd = new MulticastDelegate<(joyStick: JoyStick) => void>();
        }
        return this._onTouchEnd;
    }

    protected onLoad(): void {
        this._uiTransform = this.getComponent(UITransform)!;
        if (this.node.parent) {
            this._parentUITransform = this.node.parent.getComponent(UITransform)!;
        }

        if (!this.pole) {
            this.pole = this.node.getChildByName('Pole')!;
        }
        if (!this.dish) {
            this.dish = this.node.getChildByName('Dish')!;
        }

        // 计算最大半径
        if (this.dish) {
            const dishUITransform = this.dish.getComponent(UITransform);
            if (dishUITransform) {
                this._maxRadius = dishUITransform.width * 0.3;
            }
        }

        this.registerEvent(true);
        GameManager.getInstance()?.registerPausableObject(this);
        // 默认隐藏摇杆
        this.showJoyStick(false);
    }

    protected onDestroy(): void {
        GameManager.getInstance()?.unregisterPausableObject(this);
        this.registerEvent(false);
    }

    private registerEvent(value: boolean) {
        if (value) {
            input.on(Input.EventType.TOUCH_START, this.touchStart, this);
            input.on(Input.EventType.TOUCH_END, this.touchEnd, this);
            input.on(Input.EventType.TOUCH_MOVE, this.touchMove, this);
            input.on(Input.EventType.TOUCH_CANCEL, this.touchCancel, this);
        }
        else {
            input.off(Input.EventType.TOUCH_START, this.touchStart, this);
            input.off(Input.EventType.TOUCH_END, this.touchEnd, this);
            input.off(Input.EventType.TOUCH_MOVE, this.touchMove, this);
            input.off(Input.EventType.TOUCH_CANCEL, this.touchCancel, this);
        }
    }

    public pause(value: boolean): void {
        if (value) this.resetTouchState();
        this.registerEvent(!value);
    }

    private touchStart(event: EventTouch) {
        if (!this._parentUITransform) return;

        // 更新摇杆底盘位置到触摸点
        const touchUILoc = event.getUILocation();
        this._parentUITransform.convertToNodeSpaceAR(
            v3(touchUILoc.x, touchUILoc.y, 0),
            this._tempPos
        );
        this.node.setPosition(this._tempPos);

        // 重置圆点到中心
        if (this.pole) {
            this.pole.setPosition(Vec3.ZERO);
        }

        // 显示摇杆
        this.showJoyStick(true);

        this.inputVector.set(0, 0);

        this._onTouchStart?.invoke(this);
    }

    private touchMove(event: EventTouch) {
        if (!this.node.active) return;
        if (!this._uiTransform || !this.pole) return;

        // 获取触摸点的 UI 坐标
        const touchUILoc = event.getUILocation();
        // 将触摸点转换到摇杆节点的局部坐标系
        this._uiTransform.convertToNodeSpaceAR(
            v3(touchUILoc.x, touchUILoc.y, 0),
            this._tempPos
        );
        const len = this._tempPos.length();

        // 计算相对中心点的偏移距离，限制在最大半径内
        if (len > this._maxRadius) {
            this._tempPos.multiplyScalar(this._maxRadius / len);
        }
        // 更新 Pole 圆点位置
        this.pole.setPosition(this._tempPos);

        // 计算输入向量
        this._inputVector.set(this._tempPos.x, this._tempPos.y);

        this._onTouchMove?.invoke(this);
    }

    private touchEnd(event: EventTouch) {
        this.resetTouchState();
    }

    private touchCancel(event: EventTouch) {
        this.resetTouchState();
    }

    private resetTouchState(): void {
        if (!this.isTouching) return;

        // 重置圆点位置并隐藏摇杆
        if (this.pole) {
            this.pole.setPosition(Vec3.ZERO);
        }

        this.showJoyStick(false);

        this.inputVector.set(0, 0);

        this._onTouchEnd?.invoke(this);
    }

    private showJoyStick(value: boolean) {
        this.node.active = value;
    }
}