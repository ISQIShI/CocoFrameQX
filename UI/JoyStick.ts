import { _decorator, Component, EventTouch, Input, input, Node, UITransform, v3, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('JoyStick')
export class JoyStick extends Component {

    @property({ type: Node, tooltip: '摇杆圆点' })
    public pole: Node = null!;

    @property({ type: Node, tooltip: '摇杆底盘' })
    public dish: Node = null!;

    private _maxRadius: number = 60;
    private _uiTransform: UITransform = null!;
    private _parentUITransform: UITransform = null!;

    private _tempPos: Vec3 = new Vec3();

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

        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);

        // 默认隐藏摇杆
        this.showJoyStick(false);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private onTouchStart(event: EventTouch) {
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
    }

    private onTouchMove(event: EventTouch) {
        if (!this.node.active) return;
        if (!this._uiTransform || !this.pole) return;

        // 获取触摸点的 UI 坐标
        const touchUILoc = event.getUILocation();
        // 将触摸点转换到摇杆节点的局部坐标系
        this._uiTransform.convertToNodeSpaceAR(
            v3(touchUILoc.x, touchUILoc.y, 0),
            this._tempPos
        );
        // 计算相对中心点的偏移距离，限制在最大半径内
        const len = this._tempPos.length();
        if (len > this._maxRadius) {
            this._tempPos.multiplyScalar(this._maxRadius / len);
        }
        // 更新 Pole 圆点位置
        this.pole.setPosition(this._tempPos);
    }

    private onTouchEnd(event: EventTouch) {
        // 重置圆点位置并隐藏摇杆
        if (this.pole) {
            this.pole.setPosition(Vec3.ZERO);
        }
        this.showJoyStick(false);
    }

    private onTouchCancel(event: EventTouch) {
        // 重置圆点位置并隐藏摇杆
        if (this.pole) {
            this.pole.setPosition(Vec3.ZERO);
        }
        this.showJoyStick(false);
    }

    private showJoyStick(value: boolean) {
        this.node.active = value;
    }
}


