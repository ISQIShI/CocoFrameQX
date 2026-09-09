import { _decorator, CCFloat, Component, Node, Quat, Vec3 } from 'cc';
import { Stack } from '../DataStructure/Stack';

const { ccclass, property } = _decorator;

@ccclass('Bag')
export class Bag extends Component {
    @property({ type: CCFloat, min: 0 })
    public spacingDistance: number = 0;

    private _items: Stack<Node> = new Stack<Node>();

    public get itemCount(): number {
        return this._items.count;
    }

    public calculateItemHeight(index: number): number {
        return index * this.spacingDistance;
    }

    public calculateLocalPosition(out: Vec3, index: number) {
        out.set(0, this.calculateItemHeight(index), 0);
        return out;
    }

    private _tempVec3: Vec3 = new Vec3();

    public calculateWorldPosition(out: Vec3, index: number) {
        this.calculateLocalPosition(this._tempVec3, index);
        // 计算世界坐标
        Vec3.transformMat4(out, this._tempVec3, this.node.worldMatrix);
        return out;
    }

    public refreshPos(item: Node, index: number) {
        item.setParent(this.node, true);
        // 计算物品的位置
        item.setPosition(0, this.calculateItemHeight(index), 0);
        // 重置旋转
        item.setRotation(Quat.IDENTITY);
    }

    public pushItem(item: Node, refreshPos: boolean = true): number {
        const index = this._items.count;
        this._items.push(item);
        if (refreshPos) {
            this.refreshPos(item, index);
        }
        // 返回索引
        return index;
    }

    public popItem(resetPos: boolean = true): Node {
        if (this._items.isEmpty) {
            return null;
        }
        const item = this._items.pop();
        if (resetPos) {
            item.setParent(null);
        }
        return item;
    }

    public peekItem(): Node {
        if (this._items.isEmpty) {
            return null;
        }
        return this._items.peek();
    }

}


