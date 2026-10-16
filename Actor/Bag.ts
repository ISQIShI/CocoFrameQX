import { _decorator, CCFloat, math, Node, Quat, Tween, Vec3 } from 'cc';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
import { ProductContainer, TransferItem } from '../Product/ProductContainer';
import { TweenUtil } from '../Utils/TweenUtil';

const { ccclass, property } = _decorator;

@ccclass('Bag')
export class Bag extends ProductContainer {

    @property({ tooltip: '物品旋转角度' })
    public itemRotation: Vec3 = new Vec3();

    @property({ type: CCFloat, min: 0 })
    public spacingDistance: number = 0.1;

    @property({ tooltip: '是否启用物理效果' })
    public enablePhysicalEffect: boolean = false;

    @property({ type: CCFloat, tooltip: '物理偏移', visible: function (this: Bag) { return this.enablePhysicalEffect; } })
    public physicalOffset: number = 0.01;

    @property({ type: CCFloat, tooltip: '最大偏移极限值', visible: function (this: Bag) { return this.enablePhysicalEffect; } })
    public maxPhysicalOffset: number = 0.5; // 最大偏移极限值（可根据视觉需求调整常量，例如 0.5 表示最顶上最多往后偏 0.5 米）

    @property({ type: CCFloat, tooltip: '物品移动速度', visible: function (this: Bag) { return this.enablePhysicalEffect; } })
    public itemSpeed: number = 10;

    protected _lastWorldPos: Vec3 = new Vec3();

    public capacity: number = -1; // -1表示无限容量

    protected _onBagCountChange: MulticastDelegate<(bag: Bag, isAdd: boolean, item: Node) => void>;

    public get onBagCountChange(): MulticastDelegate<(bag: Bag, isAdd: boolean, item: Node) => void> {
        if (!this._onBagCountChange) {
            this._onBagCountChange = new MulticastDelegate<(bag: Bag, isAdd: boolean, item: Node) => void>();
        }
        return this._onBagCountChange;
    }

    public get isFull(): boolean {
        if (this.capacity < 0) {
            return false;
        }
        return this.itemCount + this.comingItemCount >= this.capacity;
    }

    protected start(): void {
        this._lastWorldPos.set(this.node.worldPosition);
    }

    protected update(dt: number): void {
        if (this.enablePhysicalEffect && this.itemCount > 0) {
            // const factor = Math.min(1.0, this.itemSpeed * dt);
            const factor = 1.0 - Math.exp(-this.itemSpeed * dt);

            if (Vec3.equals(this.node.worldPosition, this._lastWorldPos)) {
                for (let i = 0; i < this._items.count; i++) {
                    const item = this._items.getElement(i);
                    const result = math.lerp(item.position.z, 0, factor);
                    item.setPosition(item.position.x, item.position.y, result);
                }
            }
            else {
                for (let i = 0; i < this._items.count; i++) {
                    const item = this._items.getElement(i);

                    // 1. 直接取节点的高度 y（确保只与高度相关，且任何背包在同高度下值完全一致）
                    const y = Math.max(0, item.position.y);

                    // 2. 二次方弧度计算：模拟原有的 t * t 效果，越高偏移量增加越快
                    // 若希望直接复用原有的 physicalOffset 量级（约 0.01），可先将 y 按 spacingDistance 还原为等效层高
                    // const normalizedY = this.spacingDistance > 0 ? (y / this.spacingDistance) : y;
                    // const rawOffset = normalizedY * normalizedY * this.physicalOffset;
                    const rawOffset = y * y * this.physicalOffset;

                    // 3. 阻尼收敛：数量少/高度低时接近 rawOffset，高度极高时平滑逼近 this.maxPhysicalOffset，防止过度偏移
                    const targetZ = -((rawOffset * this.maxPhysicalOffset) / (rawOffset + this.maxPhysicalOffset));

                    const result = math.lerp(item.position.z, targetZ, factor);
                    item.setPosition(item.position.x, item.position.y, result);
                }


                // const count = this._items.count;// this._items.count
                // const space = this._items.count == 1 ? 0 : 1 / (count - 1);
                // // const maxOffset = count * this.physicalOffset;
                // for (let i = 0; i < this._items.count; i++) {
                //     const item = this._items.getElement(i);
                //     const t = i * space;
                //     const maxOffset = (i + 1) * this.physicalOffset;
                //     const result = math.lerp(item.position.z, -((t * t) * (maxOffset)), factor);
                //     item.setPosition(item.position.x, item.position.y, result);
                // }
            }
            this._lastWorldPos.set(this.node.worldPosition);
        }
    }

    public popItem(): Node {
        const item = super.popItem();
        if (item) {
            this.onBagCountChange.invoke(this, false, item);
            Tween.stopAllByTag(1, item);
            item.setScale(1, 1, 1);
        }
        return item;
    }

    public itemArrive(transferItem: TransferItem): void {
        super.itemArrive(transferItem);
        transferItem.item.setRotationFromEuler(this.itemRotation);

        this.onBagCountChange.invoke(this, true, transferItem.item);

        TweenUtil.jelly(transferItem.item, 0.8).tag(1).start();
    }

    public getItemParent(id: number): Node {
        return this.node;
    }

    public calculateLocalPos(transferItem: TransferItem): Vec3 {
        const id = this.idToIndex(transferItem.itemId);
        transferItem.targetPos.set(0, 0, 0);
        transferItem.targetPos.y += id * this.spacingDistance;
        return transferItem.targetPos;
    }
}


