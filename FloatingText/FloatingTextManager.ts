import { _decorator, instantiate, Node, Prefab, Quat } from 'cc';
import { RingDeque } from '../DataStructure/RingDeque';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
const { ccclass, property } = _decorator;

@ccclass('FloatingTextManager')
export class FloatingTextManager extends ComponentSingletonBase {
    @property({ type: Prefab, visible: true })
    private _prefab: Prefab;

    private _queue = new RingDeque<Node>();

    public getFloatingText(autoActive: boolean = true): Node {
        let node: Node;
        if (this._queue.size === 0) {
            node = instantiate(this._prefab);
            node.setParent(this.node, true);
            node.setRotation(Quat.IDENTITY);
        }
        else {
            node = this._queue.popFront()!;
        }
        node.active = autoActive;
        return node;
    }

    public returnFloatingText(node: Node) {
        if (this._queue.size > 10) {
            node.destroy();
        }
        else {
            node.active = false;
            node.setParent(this.node, true);
            node.setRotation(Quat.IDENTITY);
            this._queue.pushBack(node);
        }
    }
}


