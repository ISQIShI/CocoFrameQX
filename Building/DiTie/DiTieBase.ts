import { _decorator, CCBoolean, CCFloat, Component, ITriggerEvent, RigidBody } from 'cc';
import { ProductManager } from '../../Global/ProductManager';
import { Product } from '../../Product/Product';
import { ColletDiTie } from './ColletDiTie';
import { Bag } from '../../Actor/Bag';
const { ccclass, property } = _decorator;

@ccclass('DiTieBase')
export abstract class DiTieBase extends Component {
    @property({ type: ColletDiTie, visible: true })
    protected _diTie: ColletDiTie;

    @property({ type: CCFloat, visible: true })
    protected _receiveCoolDown: number = 0.02;

    @property({ visible: true })
    protected _autoHide: boolean = true;

    protected _isReady: boolean = true;

    protected _collectCount: number = 0;

    protected start(): void {
        if (this.onTriggerEnter) {
            this._diTie.collider.on('onTriggerEnter', this.onTriggerEnter, this);
        }
        this._diTie.collider.on('onTriggerStay', this.onTriggerStay, this);
        if (this.onTriggerExit) {
            this._diTie.collider.on('onTriggerExit', this.onTriggerExit, this);
        }
        this._diTie.finishCallBack = this.finish.bind(this);

        this.node.active = !this._autoHide;
    }

    protected onTriggerEnter?(event: ITriggerEvent): void;

    protected onTriggerExit?(event: ITriggerEvent): void;

    protected onTriggerStay(event: ITriggerEvent) {
        if (this._isReady && this._collectCount < this._diTie.maxScore) {
            const bag = this.getBag(event);
            if (bag) {
                if (bag.itemCount <= 0) {
                    return;
                }
                this._isReady = false;
                this._collectCount++;

                const productNode = bag.popItem(false);
                productNode.setParent(this.node, true);
                const product = productNode.getComponent(Product);
                product.throwToPos(() => this.node.worldPosition, 0.3, () => {
                    this._diTie.updateScore(this._diTie.targetScore - 1);
                    this.onProductReceived(product);
                });
                this.scheduleOnce(() => {
                    this._isReady = true;
                }, this._receiveCoolDown);
            }
        }
    }

    protected abstract getBag(event: ITriggerEvent): Bag;

    protected abstract onProductReceived(product: Product): void;

    protected abstract finish(diTie: ColletDiTie): void;
}


