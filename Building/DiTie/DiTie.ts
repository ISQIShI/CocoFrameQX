import { _decorator, Collider, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DiTie')
export class DiTie extends Component {

    @property(Collider)
    public collider: Collider;

    @property({ type: Node, visible: true })
    private _highlight: Node;

    protected start(): void {
        if (!this._highlight) {
            this._highlight = this.node.getChildByName('highlight');
        }
    }

    public updateColor(value: boolean) {
        if (!this._highlight) return;
        if (value) {
            this._highlight.active = true;
        } else {
            this._highlight.active = false;
        }
    }
}


