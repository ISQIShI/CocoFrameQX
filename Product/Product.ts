import { _decorator, Component, director, IVec3, Node, tween, Vec3 } from 'cc';
import { MathUtil } from '../Utils/MathUtil';
import { TweenUtil } from '../Utils/TweenUtil';
const { ccclass, property } = _decorator;

@ccclass('Product')
export class Product extends Component {

    protected static _tempParent: Node;

    public static get tempParent(): Node {
        if (!this._tempParent) {
            this._tempParent = new Node('TempParent');
            // 放入场景根节点
            director.getScene().addChild(this._tempParent);
        }
        return this._tempParent;
    }

    protected _isMoving = false;

    public get isMoving() {
        return this._isMoving;
    }

    // 投掷到指定位置(世界坐标)
    public throwToPos(targetPos: IVec3 | (() => IVec3), delay: number) {
        this._isMoving = true;

        const t = TweenUtil.throwToPos(this.node, targetPos, delay);

        t.call(() => {
            this._isMoving = false;
        });

        return t;
    }
}


