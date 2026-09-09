import { _decorator, Component, Node, Vec3 } from 'cc';
const { ccclass, property, disallowMultiple } = _decorator;

@ccclass('CameraFollow')
@disallowMultiple(true)
export class CameraFollow extends Component {

    @property({ type: Node, tooltip: '跟随目标' })
    public followTarget: Node;

    @property({ tooltip: '相机相对于目标的偏移量' })
    public offset: Vec3 = new Vec3();

    protected lateUpdate(deltaTime: number) {
        if (this.followTarget) {
            const targetPosition = this.followTarget.worldPosition;
            this.node.setWorldPosition(targetPosition.x + this.offset.x, targetPosition.y + this.offset.y, targetPosition.z + this.offset.z);
        }
    }

}


