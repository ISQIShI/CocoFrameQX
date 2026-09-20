import { _decorator, CCObject, CCString, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('NodeWrapper')
abstract class NodeWrapper {
    public abstract get nodeName(): string;
    public abstract getNode(parentNode: Node): Node;
    public abstract apply(parentNode: Node);
}

@ccclass('SingleNodeWrapper')
class SingleNodeWrapper extends NodeWrapper {

    @property({ type: CCString, visible: false })
    private _nodeName: string;

    @property({ type: CCString, tooltip: '节点', visible: true })
    public get nodeName(): string {
        return this._nodeName;
    }

    public getNode(parentNode: Node): Node {
        return parentNode.getChildByName(this._nodeName);
    }

    public constructor(nodeName: string) {
        super();
        this._nodeName = nodeName;
    }

    public apply(parentNode: Node) {
        const node = this.getNode(parentNode);
        if (node) {
            this.activeRecursively(node);
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

    @property({ type: CCString, visible: false })
    private _nodeName: string;

    @property({ type: CCString, tooltip: '节点', visible: true })
    public get nodeName(): string {
        return this._nodeName;
    }

    public getNode(parentNode: Node): Node {
        return parentNode.getChildByName(this._nodeName);
    }

    @property({ type: [NodeWrapper], visible: false })
    private _childNodes: NodeWrapper[] = [];

    @property({ type: [NodeWrapper], tooltip: '子节点', visible: true })
    public get childNodes(): NodeWrapper[] {
        return this._childNodes;
    }

    public constructor(nodeName: string) {
        super();
        this._nodeName = nodeName;
    }

    public apply(parentNode: Node) {
        const node = this.getNode(parentNode);
        if (node) {
            node.active = true;
        }
        let index = 0;
        for (const child of node.children) {
            if (index < this._childNodes.length && child === this._childNodes[index].getNode(node)) {
                this._childNodes[index].apply(node);
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

    @property({ type: [Node], tooltip: '根节点', visible: true })
    protected _rootNodes: Node[] = [];

    @property({ type: [NodeWrapper], visible: false })
    protected _activatedNode: NodeWrapper[];

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
            if (this._rootNodes.length === 0) {
                console.error('根节点未设置，无法进行记录');
                return;
            }
            this._activatedNode = [];
            for (const rootNode of this._rootNodes) {
                MapRecorder.recordNodes(rootNode, this._activatedNode);
            }
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
            nodeArr.push(new SingleNodeWrapper(node.name));
        }
        else {
            const compositeNode = new CompositeNodeWrapper(node.name);
            let nodeWrapper: NodeWrapper = compositeNode;
            for (const child of node.children) {
                this.recordNodes(child, compositeNode.childNodes);
            }
            if (compositeNode.childNodes.length === node.children.length) {
                // 判断是否所有子节点均为 SingleNodeWrapper
                let index = 0;
                for (index = 0; index < compositeNode.childNodes.length; index++) {
                    if (!(compositeNode.childNodes[index] instanceof SingleNodeWrapper)) {
                        break;
                    }
                }
                if (index === compositeNode.childNodes.length) {
                    // 所有子节点都是 SingleNodeWrapper
                    nodeWrapper = new SingleNodeWrapper(node.name);
                }
            }
            nodeArr.push(nodeWrapper);
        }
    }

    /**
     * 应用记录的节点激活状态
     */
    public apply() {
        let index = 0;
        for (const rootNode of this._rootNodes) {
            if (index < this._activatedNode.length && rootNode === this._activatedNode[index].getNode(rootNode.parent)) {
                this._activatedNode[index].apply(rootNode.parent);
                index++;
            }
            else {
                rootNode.active = false;
            }
        }
    }
}