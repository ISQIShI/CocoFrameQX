import { _decorator, CCFloat, math, Node, Quat, Vec3 } from 'cc';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';
import { ProductContainer, TransferItem } from '../Product/ProductContainer';

const { ccclass, property } = _decorator;

@ccclass('Bag')
export class Bag extends ProductContainer {
    @property({ type: CCFloat, min: 0 })
    public spacingDistance: number = 0.1;

    @property({ tooltip: '是否启用物理效果' })
    public enablePhysicalEffect: boolean = false;

    @property({ type: CCFloat, tooltip: '物理偏移', visible: function (this: Bag) { return this.enablePhysicalEffect; } })
    public physicalOffset: number = 0.01;

    @property({ type: CCFloat, tooltip: '物品移动速度', visible: function (this: Bag) { return this.enablePhysicalEffect; } })
    public itemSpeed: number = 10;

    private _lastWorldPos: Vec3 = new Vec3();

    public capacity: number = -1; // -1表示无限容量

    private _onBagCountChange: MulticastDelegate<(bag: Bag, isAdd: boolean) => void>;

    public get onBagCountChange(): MulticastDelegate<(bag: Bag, isAdd: boolean) => void> {
        if (!this._onBagCountChange) {
            this._onBagCountChange = new MulticastDelegate<(bag: Bag, isAdd: boolean) => void>();
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
                const space = this._items.count == 1 ? 0 : 1 / (this._items.count - 1);
                const maxOffset = this._items.count * this.physicalOffset;
                for (let i = 0; i < this._items.count; i++) {
                    const item = this._items.getElement(i);
                    const t = i * space;
                    const result = math.lerp(item.position.z, -((t * t) * (maxOffset)), factor);
                    item.setPosition(item.position.x, item.position.y, result);
                }
            }
            this._lastWorldPos.set(this.node.worldPosition);
        }
    }

    public popItem(): Node {
        const item = super.popItem();
        if (item) {
            this.onBagCountChange.invoke(this, false);
        }
        return item;
    }

    public itemArrive(transferItem: TransferItem): void {
        super.itemArrive(transferItem);

        // 重置旋转
        transferItem.item.setRotation(Quat.IDENTITY);
        this.onBagCountChange.invoke(this, true);
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


