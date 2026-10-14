import { _decorator, Component, instantiate, Node, Prefab, Quat, Vec3 } from 'cc';
import { PlayerActor } from '../../../Actor/PlayerActor/PlayerActor';
const { ccclass, property } = _decorator;

/** 弧度转角度系数(箭头俯仰角计算用) */
const RAD2DEG = 180 / Math.PI;

/**
 * JianTou2D 引导蚂蚁线(贴地形版)
 * 路径规则: 自身位置 -> 途径点(按顺序, 可多个) -> 目标点
 * 单个斜坡时配置两个途径点(坡下边缘 / 坡上边缘),
 * 即自动形成 "地面段 + 斜坡段 + 台上段" 最多3条蚂蚁线;
 * 斜坡段箭头会沿坡面俯仰, 紧贴斜坡, 不再穿模
 */
@ccclass('JianTou2D')
export class JianTou2D extends Component {

    @property({ type: Prefab, displayName: "箭头预制体" })
    jt2dfab: Prefab = null;

    @property({ type: Node, displayName: "引导目标节点(留空则自动跟随运行时目标)" })
    target_YD_Node: Node = null;

    @property({ type: [Node], displayName: "途径点(按从近到远排序: 坡下边缘->坡上边缘)" })
    waypointNodes: Node[] = [];

    @property({ displayName: "箭头父节点名(自动查找该子节点)" })
    arrowParentName: string = "JT2DList";

    @property({ displayName: "箭头间距(米)" })
    arrowSpacing: number = 0.6;

    @property({ displayName: "箭头流动速度(米/秒)" })
    arrowFlowSpeed: number = 1.2;

    @property({ displayName: "箭头离地抬高(米)" })
    arrowYOffset: number = 0.06;

    @property({ displayName: "箭头朝向反转180度" })
    arrowFlip: boolean = false;

    //#region 运行时缓存
    private allArrow: Node[] = [];          // 当前所有箭头
    private arrowOffset: number = 0;        // 流动相位(沿整条路径的弧长偏移)
    private _arrowParent: Node = null;      // 箭头父节点缓存
    private _warnedParent: boolean = false; // 找不到箭头父节点时只警告一次

    private _ptsPool: Vec3[] = [];          // 路径点对象池(避免每帧new, 防止GC)
    private _ptCount: number = 0;           // 当前有效路径点数量
    private _cumLens: number[] = [];        // 路径点累计弧长
    private _totalLen: number = 0;          // 路径总长度

    private _tmpPos: Vec3 = new Vec3();     // 取点位置(复用)
    private _tmpDir: Vec3 = new Vec3();     // 取点切线(复用)
    private _tmpQuat: Quat = new Quat();    // 箭头朝向(复用)
    private _tmpPitchQuat: Quat = new Quat(); // 俯仰角四元数(复用)
    private _flipQuat: Quat = new Quat();   // 反转180度四元数(复用)

    private _flowPaused: boolean = false;    // 手动暂停流动标记(由pauseFlow/resumeFlow控制)
    //#endregion

    start() {
        // 预计算"绕自身Y轴旋转180度"四元数(用于箭头朝向反转)
        Quat.fromAxisAngle(this._flipQuat, Vec3.UP, Math.PI);
    }

    update(deltaTime: number) {
        this.jianTouMove(deltaTime);
    }

    onDisable() {
        this.clearArrows();
    }

    onDestroy() {
        this.clearArrows();
    }

    //#region 对外控制接口
    /** 暂停箭头流动(手动调用, 优先级高于"移动时暂停"自动检测; 箭头仍会跟随目标/路径) */
    public pauseFlow() {
        this._flowPaused = true;
    }

    /** 恢复箭头流动 */
    public resumeFlow() {
        this._flowPaused = false;
    }
    //#endregion

    //#region 引导箭头主流程
    jianTouMove(dt: number) {
        const target = this.getTargetNode();
        if (!target) {
            this.clearArrows();
            return;
        }
        this.drawArrow(dt, target);
    }

    /** 获取引导目标: 优先编辑器指定, 否则自动使用运行时(YinDao动态刷新)的actor目标 */
    private getTargetNode(): Node | null {
        if (this.target_YD_Node && this.target_YD_Node.isValid) {
            return this.target_YD_Node;
        }
        // const actorTarget = PlayerActor.getInstance().node && this.target_YD_Node;
        // if (actorTarget && actorTarget.isValid) {
        //     return actorTarget;
        // }
        return null;
    }

    public drawArrow(dt: number, target: Node) {
        const arrowParent = this.getArrowParent();
        if (!arrowParent || !this.jt2dfab) {
            return;
        }

        this.buildPath(target);
        // 路径过短(人已到达目标附近)时隐藏所有箭头
        if (this._ptCount < 2 || this._totalLen < 0.01) {
            this.clearArrows();
            return;
        }

        const spacing = Math.max(0.05, this.arrowSpacing);
        const num = Math.floor(this._totalLen / spacing);//获得需要几个箭头

        if (num <= 0) {
            this.clearArrows();
            return;
        }

        // 均匀步距 = 路径总长/箭头数量: 把 num 个箭头均匀铺满整条路径(含首尾回绕处),
        // 与设定间距的最大偏差 < 间距/箭头数(通常<4%, 肉眼不可见);
        // 不能用"设定间距直接取模": 总长非间距整数倍时, 末尾会残留"间距+余数"的双倍宽空缺,
        // 且随流动相位与路径长度变化沿途滑动, 人物移动时出现明显断档
        const step = this._totalLen / num;

        // 箭头数量增减(增量复用已有箭头, 避免频繁创建销毁)
        const need = num - this.allArrow.length;
        if (need > 0) {
            for (let a = 0; a < need; a++) {
                const arrow = instantiate(this.jt2dfab);
                arrow.parent = arrowParent;
                this.allArrow.push(arrow);
            }
        } else if (need < 0) {
            this.allArrow.splice(num, -need).forEach((arrow) => {
                if (arrow && arrow.isValid) arrow.destroy();
            });
        }

        // 箭头朝向目标循环流动: 相位沿"整条路径弧长"持续累加,
        // 每个箭头按 (索引*均匀步距 + 相位) 对路径总长取模, 越过终点后回绕到起点;
        // 流动/暂停由外部调用 pauseFlow() / resumeFlow() 控制
        if (!this._flowPaused) {
            this.arrowOffset = (this.arrowOffset + this.arrowFlowSpeed * dt) % this._totalLen;
        }

        for (let i = 0; i < this.allArrow.length; i++) {
            const s = (i * step + this.arrowOffset) % this._totalLen;
            this.samplePath(s, this._tmpPos, this._tmpDir); // 按弧长取路径上的点与切线
            this._tmpPos.y += this.arrowYOffset;            // 抬高一点避免与地面Z-Fighting
            const arrow = this.allArrow[i];
            arrow.setWorldPosition(this._tmpPos);
            // 箭头朝向 = 先绕Y轴偏航到水平朝向, 再绕自身X轴俯仰出坡面倾角:
            // 平地时纯转向; 斜坡上自动带上俯仰角, 箭头面贴合坡面且法线始终朝上.
            // 注意不能用 Quat.rotationTo(+Z, 切线): 方向接近-Z且带竖直分量时,
            // 最短弧会绕X轴翻转约180°, 箭头法线朝下被单面材质背面剔除, 斜坡/高台上会"看不到箭头"
            const dx = this._tmpDir.x;
            const dy = this._tmpDir.y;
            const dz = this._tmpDir.z;
            Quat.fromEuler(this._tmpQuat, 0, Math.atan2(dx, dz) * RAD2DEG, 0);
            const horiz = Math.sqrt(dx * dx + dz * dz);// 切线水平分量长度
            if (horiz > 0.0001) {
                const pitchDeg = -Math.atan2(dy, horiz) * RAD2DEG;// 坡面俯仰角(上坡为负→抬头上坡)
                if (Math.abs(pitchDeg) > 0.01) {
                    Quat.fromEuler(this._tmpPitchQuat, pitchDeg, 0, 0);
                    Quat.multiply(this._tmpQuat, this._tmpQuat, this._tmpPitchQuat);// 世界偏航 * 局部俯仰
                }
            }
            if (this.arrowFlip) {
                Quat.multiply(this._tmpQuat, this._tmpQuat, this._flipQuat);
            }
            arrow.setWorldRotation(this._tmpQuat);
        }
    }
    //#endregion

    //#region 路径构建
    /** 构建路径: 自身 -> 途径点(已越过的自动跳过) -> 目标 */
    private buildPath(target: Node) {
        this._ptCount = 0;
        const selfPos = this.node.worldPosition;
        const targetPos = target.worldPosition;

        this.putPoint(selfPos);
        const selfToTarget = Vec3.distance(selfPos, targetPos);

        for (let i = 0; i < this.waypointNodes.length; i++) {
            const wp = this.waypointNodes[i];
            // 空节点/已销毁/隐藏的途径点跳过(隐藏节点可用于临时关闭某段地形引导)
            if (!wp || !wp.isValid || !wp.activeInHierarchy) continue;
            const wpPos = wp.worldPosition;
            // 已经越过该途径点(比自身更靠近目标)时跳过, 避免箭头出现回头指
            if (Vec3.distance(wpPos, targetPos) >= selfToTarget) continue;
            // 与上一个路径点几乎重合时跳过, 避免产生零长度段
            if (Vec3.distance(wpPos, this._ptsPool[this._ptCount - 1]) < 0.25) continue;
            this.putPoint(wpPos);
        }

        // 终点(与上一个点重合时省略)
        if (Vec3.distance(targetPos, this._ptsPool[this._ptCount - 1]) > 0.05) {
            this.putPoint(targetPos);
        }

        // 计算累计弧长
        let total = 0;
        this._cumLens.length = this._ptCount;
        this._cumLens[0] = 0;
        for (let i = 1; i < this._ptCount; i++) {
            total += Vec3.distance(this._ptsPool[i - 1], this._ptsPool[i]);
            this._cumLens[i] = total;
        }
        this._totalLen = total;
    }

    /** 写入一个路径点(对象池复用, 避免每帧new) */
    private putPoint(p: Vec3) {
        let point = this._ptsPool[this._ptCount];
        if (!point) {
            point = new Vec3();
            this._ptsPool[this._ptCount] = point;
        }
        point.set(p);
        this._ptCount++;
    }

    /** 按弧长s在路径上取位置与切线方向 */
    private samplePath(s: number, outPos: Vec3, outDir: Vec3) {
        const pts = this._ptsPool;
        const cum = this._cumLens;
        const n = this._ptCount;
        if (s < 0) s = 0;
        if (s > this._totalLen) s = this._totalLen;

        // 找到s所在的线段(路径点很少, 直接遍历即可)
        let i = 1;
        while (i < n - 1 && cum[i] < s) i++;

        const a = pts[i - 1];
        const b = pts[i];
        const segLen = cum[i] - cum[i - 1];
        const t = segLen > 0.0001 ? (s - cum[i - 1]) / segLen : 0;

        Vec3.lerp(outPos, a, b, t);
        Vec3.subtract(outDir, b, a);
        if (outDir.lengthSqr() < 0.000001) {
            outDir.set(0, 0, 1);
        } else {
            outDir.normalize();
        }
    }
    //#endregion

    //#region 箭头管理
    /** 获取箭头父节点(带缓存查找) */
    private getArrowParent(): Node {
        if (this._arrowParent && this._arrowParent.isValid) {
            return this._arrowParent;
        }
        let parent: Node = null;
        if (this.arrowParentName) {
            parent = this.node.getChildByName(this.arrowParentName);
        }
        if (!parent) {
            if (!this._warnedParent) {
                this._warnedParent = true;
                console.warn(`[JianTou2D] 未找到箭头父节点 "${this.arrowParentName}", 箭头将挂到组件所在节点下`);
            }
            parent = this.node;
        }
        this._arrowParent = parent;
        return parent;
    }

    /** 清除所有箭头并重置流动相位 */
    private clearArrows() {
        for (let i = 0; i < this.allArrow.length; i++) {
            const arrow = this.allArrow[i];
            if (arrow && arrow.isValid) {
                arrow.destroy();
            }
        }
        this.allArrow.length = 0;
        this.arrowOffset = 0;
    }
    //#endregion

}
