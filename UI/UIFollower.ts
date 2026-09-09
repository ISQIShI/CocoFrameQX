import { _decorator, Camera, CCBoolean, CCFloat, Component, IVec3, Node, screen, Screen, Vec3, } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('UIFollower')
export class UIFollower extends Component {

    @property({ type: Node, tooltip: '跟随目标' })
    public followTarget: Node | (() => IVec3);

    @property({ type: Camera, tooltip: '相机' })
    public camera: Camera;

    @property({ tooltip: '是否启用跟随' })
    public enableFollow: boolean = true;

    @property({ tooltip: '是否启用缩放' })
    public enableScale: boolean = false;

    @property({ tooltip: '是否检查屏幕可见性' })
    public enableCheckScreenVisible: boolean = true;

    @property({ type: CCFloat, tooltip: '标准距离', min: 0 })
    public gaugedDistance: number = 10;

    @property({ tooltip: '偏移量' })
    public offset: Vec3 = new Vec3();

    @property({ type: CCFloat, tooltip: '屏幕外缓冲边距(像素)' })
    public screenMargin: number = 200;

    private _tempVec3 = new Vec3();

    private _tempVec3_1 = new Vec3();

    protected onEnable(): void {
        this.follow(false);
    }

    protected update(deltaTime: number) {
        this.follow(true);
    }

    public getFollowTargetPos(): IVec3 {
        if (!this.followTarget) {
            return null;
        }
        if (this.followTarget instanceof Node) {
            return this.followTarget.worldPosition;
        }
        else {
            return this.followTarget();
        }
    }

    private follow(checkScreenVisible: boolean) {
        if (!this.enableFollow || !this.followTarget || !this.camera) {
            return;
        }

        // 计算带偏移的世界坐标
        Vec3.add(this._tempVec3_1, this.getFollowTargetPos(), this.offset);

        if (checkScreenVisible && !this.checkScreenVisible(this._tempVec3_1)) {
            return;
        }

        this.camera.convertToUINode(this._tempVec3_1, this.node.parent, this._tempVec3);
        this.node.setPosition(this._tempVec3);

        if (this.enableScale) {
            Vec3.transformMat4(this._tempVec3, this.getFollowTargetPos(), this.camera.camera.matView);
            const ratio = this.gaugedDistance / Math.abs(this._tempVec3.z);
            this.node.setScale(ratio, ratio, 1);
        }
    }


    /**
    * 判断是否在相机前方且在屏幕可见范围内（带缓冲边距）
    */
    private checkScreenVisible(worldPos: Vec3): boolean {
        // 深度与方向检测
        // 在相机视空间中，Z 轴向前为负值；若 viewPos.z >= -this.camera.near，说明在相机背面
        Vec3.transformMat4(this._tempVec3, worldPos, this.camera.camera.matView);
        if (this._tempVec3.z >= -this.camera.near) {
            return false;
        }

        if (!this.enableCheckScreenVisible) {
            return true;
        }
        // 将 3D 世界坐标转换为屏幕像素坐标
        this.camera.worldToScreen(worldPos, this._tempVec3);
        // 获取当前屏幕/视口像素尺寸
        const winSize = screen.resolution;
        // 判断是否在屏幕矩形范围（加上缓冲区）
        const result = (
            this._tempVec3.x >= -this.screenMargin &&
            this._tempVec3.x <= winSize.width + this.screenMargin &&
            this._tempVec3.y >= -this.screenMargin &&
            this._tempVec3.y <= winSize.height + this.screenMargin
        );
        return result;
    }
}


