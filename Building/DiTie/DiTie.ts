import { _decorator, Collider, Color, Component, MeshRenderer, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DiTie')
export class DiTie extends Component {

    @property(Collider)
    public collider: Collider;

    @property({ type: Node, visible: true })
    private _frame: Node;

    private _color: Color;

    protected start(): void {
        if (!this._frame) {
            this._frame = this.node.getChildByName('Frame');
        }
        if (this._frame) {
            this._color = this._frame.getComponent(MeshRenderer).material.getProperty('albedo') as Color;
        }
    }

    public updateColor(value: boolean) {
        if (!this._frame) return;
        if (value) {
            this._frame.getComponent(MeshRenderer).material.setProperty('albedo', new Color(0, 255, 0, 255));
        }
        else {
            this._frame.getComponent(MeshRenderer).material.setProperty('albedo', this._color);
        }
    }
}


