import { _decorator, CCFloat, Node, Quat, Vec3 } from 'cc';
import { ProductContainer } from '../Product/ProductContainer';
import { MulticastDelegate } from '../Delegate/MulticastDelegate';

const { ccclass, property } = _decorator;

@ccclass('Bag')
export class Bag extends ProductContainer {
    @property({ type: CCFloat, min: 0 })
    public spacingDistance: number = 0.1;

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

    public popItem(): Node {
        const item = super.popItem();
        if (item) {
            this.onBagCountChange.invoke(this, false);
        }
        return item;
    }

    public itemArrive(item: Node, id: number): void {
        super.itemArrive(item, id);
        // 重置旋转
        item.setRotation(Quat.IDENTITY);
        this.onBagCountChange.invoke(this, true);
    }

    public getItemParent(id: number): Node {
        return this.node;
    }

    public calculateLocalPos(out: Vec3, id: number): Vec3 {
        id = this.idToIndex(id);
        out.set(0, 0, 0,);
        out.y += id * this.spacingDistance;
        return out;
    }
}


