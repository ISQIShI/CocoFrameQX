import { _decorator, CCFloat, Component, EventTouch, input, Input, Node, UIOpacity } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DragTip')
export class DragTip extends Component {

    @property({ type: CCFloat, min: 0, tooltip: '拖拽提示的超时时间（秒），超过该时间未触发拖拽则显示提示' })
    public timeoutPeriod: number = 2;

    private _timer: number = -1;

    protected onEnable(): void {
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    protected onDisable(): void {
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    protected update(dt: number): void {
        if (this._timer >= 0) {
            this._timer += dt;
            if (this._timer >= this.timeoutPeriod) {
                this.showDragTip(true);
                this._timer = -1;
            }
        }
    }
    private onTouchStart(event: EventTouch) {
        // 计时器设为 -1 停止计时
        this._timer = -1;
        this.showDragTip(false);
    }

    private onTouchEnd(event: EventTouch) {
        // 计时器设为 0 开始计时
        this._timer = 0;
    }

    private onTouchCancel(event: EventTouch) {
        // 计时器设为 0 开始计时
        this._timer = 0;
    }

    private showDragTip(value: boolean) {
        this.node.children[0].active = value;
    }
}


