import { _decorator, Component, director, IVec3, Node, randomRange, tween, Vec3 } from 'cc';
import { TweenUtil } from '../Utils/TweenUtil';
import { Utils } from './Utils';
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
    public throwToPos(targetPos: IVec3 | (() => IVec3), delay: number, controlPointHeight: number = 2) {
        this._isMoving = true;

        const t = TweenUtil.throwToPos(this.node, targetPos, delay, controlPointHeight);

        t.call(() => {
            this._isMoving = false;
        });

        return t;
    }


    moveToPos(toF: Number, pos: Vec3, delay: number, callback?) {
        let startPos = this.node.position.clone();
        let tempVec3 = new Vec3(0, 0, 0);
        let controlPos = new Vec3(0, 0, 0);
        Vec3.add(controlPos, startPos, pos);
        controlPos.multiplyScalar(0.5);

        if (toF == 0) {
            controlPos.add3f(0, 2, 0);
        } else if (toF == 1) {
            controlPos.add3f(0, 0, 2);
        } else {
            let controlPosOffset = new Vec3(randomRange(-1, 1), 2, randomRange(-1, 1));
            controlPos.add3f(controlPosOffset.x, controlPosOffset.y, controlPosOffset.z);
        }
        tween(this.node)
            .to(delay, { position: pos }, {
                onUpdate: (target, ratio) => {
                    Utils.bezierCurve(ratio, this.node.position, controlPos, pos, tempVec3);
                    this.node.setPosition(tempVec3);
                }
            })
            .call(() => {
                let initScale = this.node.scale.clone();
                Utils.jellyEffect(this.node, initScale.x, () => {
                    this.node.setWorldScale(Vec3.ONE);
                })
                callback && callback();
            })
            .start();
    }
}


