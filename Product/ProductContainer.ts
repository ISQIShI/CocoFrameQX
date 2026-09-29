import { _decorator, CCInteger, Component, director, Node, Pool, Tween, Vec3 } from 'cc';
import { LinkedList } from '../DataStructure/LinkedList';
import { Stack } from '../DataStructure/Stack';
const { ccclass, property } = _decorator;

export type TransferProcess = Tween;

export class TransferItem {

    private readonly _to: ProductContainer;

    public get to(): ProductContainer {
        return this._to;
    }

    private readonly _item: Node;

    public get item(): Node {
        return this._item;
    }

    private readonly _itemId: number;

    public get itemId(): number {
        return this._itemId;
    }

    private readonly _targetPos: Vec3;

    public get targetPos(): Vec3 {
        return this._targetPos;
    }

    public constructor(to: ProductContainer, item: Node, itemId: number) {
        this._to = to;
        this._item = item;
        this._itemId = itemId;
        this._targetPos = new Vec3();
    }

    public calculateWorldPos(): Vec3 {
        return this._to.calculateWorldPos(this);
    }

    public itemArrive(): void {
        this._to.itemArrive(this);
    }
}

@ccclass('ProductContainer')
export abstract class ProductContainer extends Component {

    protected _comingItems: LinkedList<TransferItem> = new LinkedList<TransferItem>();

    protected _items: Stack<Node> = new Stack<Node>();

    protected _globalId: number = 0;

    protected _lastId: number = 0;

    @property({ type: CCInteger })
    public get itemCount(): number {
        return this._items.count;
    }

    @property({ type: CCInteger })
    public get comingItemCount(): number {
        return this._comingItems.count;
    }

    public get totalItemCount(): number {
        return this._items.count + this._comingItems.count;
    }

    public pushItem(item: Node): TransferItem {
        const id = ++this._globalId;
        const transferItem = new TransferItem(this, item, id);
        this.calculateWorldPos(transferItem);
        this._comingItems.addLast(transferItem);
        return transferItem;
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

    public itemArrive(transferItem: TransferItem): void {
        this._lastId = transferItem.itemId;
        this._comingItems.remove(transferItem);
        this._items.push(transferItem.item);

        // 设置父节点
        transferItem.item.setParent(this.getItemParent(transferItem.itemId), true);

        // 设置位置
        this.calculateLocalPos(transferItem);
        transferItem.item.setPosition(transferItem.targetPos);
    }

    protected _tempVec3: Vec3 = new Vec3();

    protected idToIndex(id: number): number {
        return this._items.count + (id - this._lastId - 1);
    }

    public abstract getItemParent(id: number): Node;

    public abstract calculateLocalPos(transferItem: TransferItem): Vec3;

    public calculateWorldPos(transferItem: TransferItem): Vec3 {
        this._tempVec3.set(this.calculateLocalPos(transferItem));
        Vec3.transformMat4(transferItem.targetPos, this._tempVec3, this.getItemParent(transferItem.itemId).worldMatrix);
        return transferItem.targetPos;
    }

    public transferTo(to: ProductContainer, transferProcess?: (transferItem: TransferItem) => TransferProcess, autoArrive: boolean = true) {
        ProductContainer.transferItem(this, to, transferProcess, autoArrive);
    }

    public static transferItem(from: ProductContainer, to: ProductContainer, transferProcess?: (transferItem: TransferItem) => TransferProcess, autoArrive: boolean = true) {
        // 默认所有条件均满足，可以传递
        const item = from.popItem();
        const transferItem = to.pushItem(item);

        const process = transferProcess ? transferProcess(transferItem) : null;

        if (process) {
            if (process instanceof Tween) {
                if (autoArrive) {
                    process.call(() => {
                        to.itemArrive(transferItem);
                    });
                }
                process.start();
            }
        }
        else {
            if (autoArrive) {
                to.itemArrive(transferItem);
            }
        }
    }
}
