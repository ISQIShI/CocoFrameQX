import { _decorator, CCFloat, Component, ITriggerEvent, Quat, randomRange, Vec3 } from 'cc';
import { Bag } from '../../Actor/Bag';
import { Product } from '../../Product/Product';
import { TweenUtil } from '../../Utils/TweenUtil';
import { ColletDiTie } from './ColletDiTie';
const { ccclass, property } = _decorator;

@ccclass('DiTieBase')
export abstract class DiTieBase extends Component {
    @property({ type: ColletDiTie, visible: true })
    protected _diTie: ColletDiTie;

    @property({ type: CCFloat, visible: true })
    protected _receiveCoolDown: number = 0.01;

    @property({ visible: true })
    protected _autoHide: boolean = true;

    protected _triggerBag: Bag = null;

    protected _isRuning: boolean = false;

    protected _collectCount: number = 0;

    protected start(): void {
        this._diTie.collider.on('onTriggerEnter', this.onTriggerEnterInternal, this);

        this._diTie.collider.on('onTriggerExit', this.onTriggerExitInternal, this);

        this._diTie.collider.on('onTriggerStay', this.onTriggerStay, this);

        this._diTie.finishCallBack = (diTie) => {
            if (this._isRuning) {
                this._isRuning = false;
                this.unschedule(this.onTick);
            }
            this.finish(diTie);
        }

        this.node.active = !this._autoHide;
    }

    protected onDestroy(): void {
        if (this._isRuning) {
            this._isRuning = false;
            this.unschedule(this.onTick);
        }
    }

    protected onTriggerEnter?(event: ITriggerEvent): void;

    protected onTriggerExit?(event: ITriggerEvent): void;

    private onTriggerEnterInternal(event: ITriggerEvent): void {
        if (!this._triggerBag) {
            this._triggerBag = this.getBag(event);
        }
        if (this.onTriggerEnter) {
            this.onTriggerEnter(event);
        }
    }

    private onTriggerExitInternal(event: ITriggerEvent): void {
        this._triggerBag = null;
        if (this.onTriggerExit) {
            this.onTriggerExit(event);
        }
    }

    protected onTriggerStay(event: ITriggerEvent) {
        if (!this._triggerBag) {
            this._triggerBag = this.getBag(event);
        }
        if (this._isRuning) return;
        if (!this.checkCondition(this._triggerBag)) return;
        this.receiveOnce();
        this._isRuning = true;
        this.schedule(this.onTick, this._receiveCoolDown);
    }

    protected onTick() {
        if (this.checkCondition(this._triggerBag)) {
            this.receiveOnce();
        }
        else {
            this._isRuning = false;
            this.unschedule(this.onTick);
        }
    }

    protected receiveOnce() {
        const bag = this._triggerBag;
        this._collectCount++;

        const productNode = bag.popItem();
        productNode.setParent(this.node, true);
        const product = productNode.getComponent(Product);

        TweenUtil
            .setRotationSlerpByAngle(productNode, Quat.fromEuler(new Quat(), 0, randomRange(-180, 180), 0), 0.35 / 2)
            .start();

        product.throwToPos(this.node.worldPosition, 0.35)
            .call(() => {
                this._diTie.updateScore(this._diTie.targetScore - 1);
                this.onProductReceived(product);
            })
            .start();
    }

    protected checkCondition(bag: Bag): boolean {
        if (this._collectCount >= this._diTie.maxScore) return false;
        return bag && bag.itemCount > 0;
    }

    protected abstract getBag(event: ITriggerEvent): Bag;

    protected abstract onProductReceived(product: Product): void;

    protected abstract finish(diTie: ColletDiTie): void;
}


