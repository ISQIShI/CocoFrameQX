import { _decorator, Component, Node, Vec3 } from 'cc';
import { LinkedList } from '../DataStructure/LinkedList';
import { Stack } from '../DataStructure/Stack';
const { ccclass, property } = _decorator;

@ccclass('ProductContainer')
export abstract class ProductContainer extends Component {

    protected _comingItems: LinkedList<Node> = new LinkedList<Node>();

    protected _items: Stack<Node> = new Stack<Node>();

    protected _globalId: number = 0;

    protected _lastId: number = 0;

    public get itemCount(): number {
        return this._items.count;
    }

    public get comingItemCount(): number {
        return this._comingItems.count;
    }

    public pushItem(item: Node): number {
        const id = ++this._globalId;
        this._comingItems.addLast(item);
        return id;
    }

    public popItem(): Node {
        if (this._items.isEmpty) {
            return null;
        }
        return this._items.pop();
    }

    public peekItem(): Node {
        if (this._items.isEmpty) {
            return null;
        }
        return this._items.peek();
    }

    public itemArrive(item: Node, id: number): void {
        this._lastId = id;
        this._comingItems.remove(item);
        this._items.push(item);

        // 设置父节点
        item.setParent(this.getItemParent(id), true);

        // 设置位置
        this.calculateLocalPos(this._tempVec3, id);
        item.setPosition(this._tempVec3);
    }

    protected _tempVec3: Vec3 = new Vec3();

    protected idToIndex(id: number): number {
        return this._items.count + (id - this._lastId - 1);
    }

    public abstract getItemParent(id: number): Node;

    public abstract calculateLocalPos(out: Vec3, id: number): Vec3;

    public calculateWorldPos(out: Vec3, id: number): Vec3 {
        this.calculateLocalPos(this._tempVec3, id);
        Vec3.transformMat4(out, this._tempVec3, this.getItemParent(id).worldMatrix);
        return out;
    }
}



