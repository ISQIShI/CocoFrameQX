import { _decorator, CCObject, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('NodeWrapper')
abstract class NodeWrapper extends CCObject {
    public abstract get node();
    public abstract apply();
}

@ccclass('SingleNodeWrapper')
class SingleNodeWrapper extends NodeWrapper {

    @property({ type: Node, tooltip: '节点', visible: true })
    private _node: Node;

    public get node() {
        return this._node;
    }

    public constructor(node: Node) {
        super();
        this._node = node;
    }

    public apply() {
        if (this._node) {
            this.activeRecursively(this._node);
        }
    }

    private activeRecursively(node: Node) {
        node.active = true;
        for (const child of node.children) {
            this.activeRecursively(child);
        }
    }
}

@ccclass('CompositeNodeWrapper')
class CompositeNodeWrapper extends NodeWrapper {

    @property({ type: Node, tooltip: '节点', visible: true })
    private _node: Node;

    public get node() {
        return this._node;
    }

    @property({ type: [NodeWrapper], visible: false })
    private _childNodes: NodeWrapper[] = [];

    @property({ type: [NodeWrapper], tooltip: '子节点', visible: true })
    public get childNodes(): NodeWrapper[] {
        return this._childNodes;
    }

    public constructor(node: Node) {
        super();
        this._node = node;
    }

    public apply() {
        this._node.active = true;
        let index = 0;
        for (const child of this._node.children) {
            if (index < this._childNodes.length && child === this._childNodes[index].node) {
                this._childNodes[index].apply();
                index++;
            }
            else {
                child.active = false;
            }
        }
    }
}


@ccclass('MapRecorder')
export class MapRecorder extends CCObject {

    @property({ type: Node, tooltip: '根节点', visible: true })
    protected _rootNode: Node;

    @property({ type: [NodeWrapper], visible: false })
    protected _activatedNode: NodeWrapper[] = [];

    @property({ type: [NodeWrapper], tooltip: '激活的节点', visible: true })
    protected get activatedNode(): NodeWrapper[] {
        return this._activatedNode;
    }

    @property({ displayName: '点击进行记录', tooltip: '点击勾选后立即记录根节点下所有激活节点' })
    protected get record(): boolean {
        return false;
    }
    protected set record(value: boolean) {
        if (value) {
            if (!this._rootNode) {
                console.error('根节点未设置，无法进行记录');
                return;
            }
            this._activatedNode = [];
            MapRecorder.recordNodes(this._rootNode, this._activatedNode);
        }
    }

    @property({ displayName: '点击进行应用' })
    protected get applyButton(): boolean {
        return false;
    }
    protected set applyButton(value: boolean) {
        if (value) {
            this.apply();
        }
    }

    public static recordNodes(node: Node, nodeArr: NodeWrapper[]) {
        if (!node.active) return;

        if (node.children.length === 0) {
            nodeArr.push(new SingleNodeWrapper(node));
        }
        else {
            const compositeNode = new CompositeNodeWrapper(node);
            let nodeWrapper: NodeWrapper = compositeNode;
            for (const child of node.children) {
                this.recordNodes(child, compositeNode.childNodes);
            }
            if (compositeNode.childNodes.length === node.children.length) {
                // 判断是否所有字节点均为 SingleNodeWrapper
                let index = 0;
                for (index = 0; index < compositeNode.childNodes.length; index++) {
                    if (!(compositeNode.childNodes[index] instanceof SingleNodeWrapper)) {
                        break;
                    }
                }
                if (index === compositeNode.childNodes.length) {
                    // 所有子节点都是 SingleNodeWrapper
                    nodeWrapper = new SingleNodeWrapper(node);
                }
            }
            nodeArr.push(nodeWrapper);
        }
    }

    /**
     * 应用记录的节点激活状态
     */
    public apply() {
        if (this._activatedNode.length === 0) {
            this._rootNode.active = false;
            return;
        }

        for (const nodeWrapper of this._activatedNode) {
            nodeWrapper.apply();
        }
    }
}