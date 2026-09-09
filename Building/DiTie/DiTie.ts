import { _decorator, Collider, Component, Node, RigidBody } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DiTie')
export class DiTie extends Component {

    @property(Collider)
    public collider: Collider;

    public updateColor(value: boolean) {
        if (value) {
            this.node.getChildByName("zhan_g").active = true;
        } else {
            this.node.getChildByName("zhan_g").active = false;
        }
    }
}


