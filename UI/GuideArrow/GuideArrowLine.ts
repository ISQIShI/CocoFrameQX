import { _decorator, Color, Component, instantiate, IVec3Like, Node, Prefab, Size, Sprite, UITransform, Vec2, Vec3 } from 'cc';
import { GlobalPool } from '../../Global/GlobalPool';
const { ccclass, property } = _decorator;

type PosType = Node | Readonly<IVec3Like> | (() => Readonly<IVec3Like>);

const _tempColor = new Color();

class LineSegmentItem {
    private readonly _lineSegment: UITransform;

    public get uiTransform(): UITransform {
        return this._lineSegment;
    }

    private readonly _sprite: Sprite;

    public get sprite(): Sprite {
        return this._sprite;
    }

    public get node(): Node {
        return this._lineSegment.node;
    }

    public constructor(lineSegment: UITransform) {
        this._lineSegment = lineSegment;
        this._sprite = lineSegment.getComponent(Sprite);
    }
}

@ccclass('GuideArrowLine')
export class GuideArrowLine extends Component {

    @property({ type: Prefab, displayName: '线段预制体', visible: true })
    private _lineSegmentPrefab: Prefab;

    @property({ type: Node, displayName: '线段父节点', visible: true })
    private _lineParent: Node;

    @property({ type: Node, displayName: '起点节点' })
    public startPos: PosType;

    @property({ type: Node, displayName: '目标节点' })
    public targetPos: PosType;

    @property({ displayName: '最大箭头数量' })
    public maxArrowPool: number = 20;

    @property({ displayName: '箭头间距(米)' })
    public arrowSpacing: number = 1.0;

    @property({ displayName: '世界速度(米/秒)' })
    public worldSpeed: number = 1.0;

    @property({ displayName: '归一化速度' })
    public normalizedSpeed: number = 0.3;

    @property({ displayName: '速度混合系数' })
    public speedBlendFactor: number = 0.5;

    @property({ displayName: '淡入淡出距离(米)' })
    public fadeDistance: number = 2.0;

    @property({ displayName: '是否启用缩放' })
    public enableScale: boolean = false;

    @property({
        displayName: '最小缩放',
        visible: function () { return this.enableScale },
        min: 0, max: 1, step: 0.1, slide: true
    })
    public minScale: number = 0.3;

    @property({ displayName: '是否启用透明度' })
    public enableOpacity: boolean = false;

    @property({
        displayName: '最小透明度比例',
        visible: function () { return this.enableOpacity },
        min: 0, max: 1, step: 0.1, slide: true
    })
    public minOpacity: number = 0.3;

    @property({ min: 0, displayName: '原始缩放' })
    private originalScale: Vec2 = new Vec2(1, 1);

    @property({ displayName: '地面Y轴偏移' })
    public groundYOffset: number = 0.05;

    private _lineSegments: LineSegmentItem[] = [];

    private _phase: number = 0;

    private _pathLength: number = 0;

    private _isActive: boolean = false;

    public get isActive(): boolean {
        return this._isActive;
    }

    public set isActive(active: boolean) {
        this._isActive = active;
        if (!active) {
            this.hideAllArrows();
        }
    }

    private _originalSegmentSize: Size;

    private get actualSegmentWidth() {
        return this._originalSegmentSize.width * this.originalScale.x;
    }

    private get actualSegmentHeight() {
        return this._originalSegmentSize.height * this.originalScale.y;
    }

    protected start(): void {
        this.initArrows();
    }

    protected update(dt: number): void {

        let startPos = this.parsePos(this.startPos);
        startPos = startPos ? startPos : this.node.worldPosition;
        const targetPos = this.parsePos(this.targetPos);

        if (!this._isActive || !targetPos) {
            this.hideAllArrows();
            return;
        }

        // 计算路径长度
        this._pathLength = Vec3.distance(startPos, targetPos);

        // 如果距离太近，隐藏所有箭头
        if (this._pathLength < 0.5) {
            this.hideAllArrows();
            return;
        }

        // 计算混合速度
        const worldSpeedClamped = Math.max(0.5, Math.min(2.0, this.worldSpeed));
        const normalizedSpeedClamped = Math.max(0.1, Math.min(1.0, this.normalizedSpeed));

        const worldDelta = (worldSpeedClamped / this._pathLength) * dt;
        const normalizedDelta = normalizedSpeedClamped * dt;

        const speedDelta = worldDelta * (1 - this.speedBlendFactor) + normalizedDelta * this.speedBlendFactor;

        // 更新相位
        const cycle = Math.max(this.arrowSpacing, 0.0001);
        this._phase = (this._phase + speedDelta * this._pathLength) % cycle;

        // 更新每个箭头
        this.updateArrows(startPos, targetPos);
    }

    /**
     * 初始化箭头节点池
     */
    private initArrows(): void {
        if (!this._lineSegmentPrefab) {
            return;
        }

        // 创建箭头池
        for (let i = 0; i < this.maxArrowPool; i++) {
            const segment = instantiate(this._lineSegmentPrefab);

            segment.setParent(this._lineParent);
            segment.active = false;
            const uiTransform = segment.getComponent(UITransform);

            if (!this._originalSegmentSize) {
                this._originalSegmentSize = uiTransform.contentSize.clone();
            }
            this._lineSegments.push(new LineSegmentItem(uiTransform));
        }

        this._lineParent.getComponent(UITransform).setContentSize(this.actualSegmentWidth, this.actualSegmentHeight);
    }

    /**
     * 更新所有箭头的位置、旋转和缩放
     */
    private updateArrows(startPos: Readonly<IVec3Like>, targetPos: Readonly<IVec3Like>): void {
        const tempVec3 = GlobalPool.Vec3Pool.alloc();
        const direction = tempVec3;
        direction.x = targetPos.x - startPos.x;
        direction.y = 0;
        direction.z = targetPos.z - startPos.z;
        direction.normalize();

        const yawRad = Math.atan2(direction.x, direction.z);
        const yawDeg = yawRad * (180 / Math.PI);
        // 设置旋转
        this._lineParent.setWorldPosition(startPos.x, this.groundYOffset, startPos.z);
        this._lineParent.setWorldRotationFromEuler(90, yawDeg, 0);
        this._lineParent.getComponent(UITransform).setContentSize(this.actualSegmentWidth, this._pathLength / this._lineParent.worldScale.y);

        for (let i = 0; i < this._lineSegments.length; i++) {
            const segment = this._lineSegments[i];

            // 计算箭头在路径上的实际距离(米)
            const distanceAlongPath = this._phase + i * this.arrowSpacing;

            // 超出路径长度的箭头隐藏
            if (distanceAlongPath >= this._pathLength + this.arrowSpacing) {
                segment.node.active = false;
                continue;
            }

            // 计算坐标
            segment.node.setWorldPosition(startPos.x + distanceAlongPath * direction.x, this.groundYOffset, startPos.z + distanceAlongPath * direction.z);
            segment.node.active = true;


            // 计算淡入淡出

            const distFromStart = distanceAlongPath;
            const distFromEnd = this._pathLength - distanceAlongPath;

            let scaleFactor = 1.0;

            // 淡入(距离起点)
            if (distFromStart < this.fadeDistance) {
                scaleFactor = Math.min(scaleFactor, distFromStart / this.fadeDistance);
            }

            // 淡出(距离终点)
            if (distFromEnd < this.fadeDistance) {
                scaleFactor = Math.min(scaleFactor, distFromEnd / this.fadeDistance);
            }

            // 应用缩放映射
            if (this.enableScale) {
                const finalScaleFactor = this.minScale + (1 - this.minScale) * scaleFactor;
                segment.uiTransform.setContentSize(this.actualSegmentWidth * finalScaleFactor, this.actualSegmentHeight * finalScaleFactor);
            }

            // 设置透明度
            if (this.enableOpacity && segment.sprite) {
                const finalScaleFactor = this.minOpacity + (1 - this.minOpacity) * scaleFactor;
                const opacity = finalScaleFactor * 255;
                _tempColor.set(segment.sprite.color);
                _tempColor.a = opacity;
                segment.sprite.color = _tempColor;
            }
        }

        GlobalPool.Vec3Pool.free(tempVec3);
    }

    /**
     * 隐藏所有箭头
     */
    private hideAllArrows(): void {
        for (const segment of this._lineSegments) {
            if (segment && segment.node.isValid) {
                segment.node.active = false;
            }
        }
    }

    private parsePos(pos: PosType): Readonly<IVec3Like> {
        if (!pos) return null;
        if (typeof pos === 'function') {
            return pos();
        }
        else if (pos instanceof Node) {
            return pos.isValid ? pos.worldPosition : null;
        }
        else {
            return pos;
        }
    }
}
