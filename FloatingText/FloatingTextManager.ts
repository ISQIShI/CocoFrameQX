import { _decorator, Component, instantiate, Node, Prefab, Quat } from 'cc';
import { Label3D } from './Label3D';
import { Queue } from '../DataStructure/Queue';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
const { ccclass, property } = _decorator;

@ccclass('FloatingTextManager')
export class FloatingTextManager extends ComponentSingletonBase {
    @property({ type: Prefab, visible: true })
    private _prefab: Prefab;

    private _queue: Queue<Node> = new Queue<Node>();

    public getFloatingText(autoActive: boolean = true): Node {
        let node: Node;
        if (this._queue.isEmpty) {
            node = instantiate(this._prefab);
            node.setParent(this.node, true);
            node.setRotation(Quat.IDENTITY);
        }
        else {
            node = this._queue.dequeue();
        }
        node.active = autoActive;
        return node;
    }

    public returnFloatingText(node: Node) {
        if (this._queue.count > 10) {
            node.destroy();
        }
        else {
            node.active = false;
            node.setParent(this.node, true);
            node.setRotation(Quat.IDENTITY);
            this._queue.enqueue(node);
        }
    }
}


