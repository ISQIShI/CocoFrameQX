import { _decorator, CCInteger, Collider, Component, game, Animation, Material, MeshRenderer, Node, tween, Vec3, math } from 'cc';
import { GlobalPool } from '../../Global/GlobalPool';
const { ccclass, property } = _decorator;

@ccclass('ColletDiTie')
export class ColletDiTie extends Component {
    @property({ type: Material, visible: true })
    private _scoreMaterialArr: Material[] = [];

    @property({ type: MeshRenderer, visible: true })
    private _baiWei: MeshRenderer;

    @property({ type: MeshRenderer, visible: true })
    private _shiWei: MeshRenderer;

    @property({ type: MeshRenderer, visible: true })
    private _geWei: MeshRenderer;

    @property({ type: Collider, visible: true })
    private _collider: Collider;

    public get collider() {
        return this._collider;
    }

    @property({ type: Node, visible: true })
    private _progress: Node;

    @property({ type: CCInteger, visible: true })
    private _maxScore = 50;

    public get maxScore() {
        return this._maxScore;
    }

    public set maxScore(value) {
        this._maxScore = value;
        if (this._maxScore <= 0) this._maxScore = 0;
    }

    @property({ type: CCInteger, visible: true })
    private _currentScore = 50;

    public get currentScore() {
        return this._currentScore;
    }

    @property({ type: CCInteger, visible: true })
    private _targetScore = 50;

    public get targetScore() {
        return this._targetScore;
    }

    private _scoreAnimation: Animation;

    private _putTime: number = 0;
    private _ADD_TIME: number = 250;

    private _finishCallBack: (ditie: ColletDiTie) => void = null;

    private _callBackExecuteOnce: boolean = true;

    private _initScale: Vec3 = null;

    public get isFinished() {
        return this._currentScore === 0;
    }

    public set finishCallBack(value: (ditie: ColletDiTie) => void) {
        this._finishCallBack = value;
        this._callBackExecuteOnce = false;
    }

    public set finishCallBackOnce(value: (ditie: ColletDiTie) => void) {
        this._finishCallBack = value;
        this._callBackExecuteOnce = true;
    }

    protected start(): void {
        this.updateScoreNumber(Math.floor(this._currentScore / 100 % 10), Math.floor(this._currentScore / 10 % 10), Math.floor(this._currentScore % 10));
        this.updateProgress();
        this.updateColor(false);

        this._scoreAnimation = this.node.getComponent(Animation);
    }

    protected update(dt: number): void {
        if (this._currentScore != this._targetScore) {
            let d = this._targetScore - this._currentScore;
            if (Math.abs(d) < 2) {
                this._currentScore = this._targetScore;
            } else {
                dt = dt * 1000;
                let t = (this._putTime + this._ADD_TIME) - game.totalTime;
                if (Math.abs(t) <= dt) {
                    this._currentScore = this._targetScore;
                } else {
                    let sr = t / dt;
                    let dr = Math.round(d / sr);
                    this._currentScore += dr;
                }
                if (this._currentScore < 0) this._currentScore = this._targetScore;
            }
            const baiWeiScore = Math.floor(this._currentScore / 100 % 10);
            const shiWeiScore = Math.floor(this._currentScore / 10 % 10);
            const geWeiScore = Math.floor(this._currentScore % 10);

            this.updateScoreNumber(baiWeiScore, shiWeiScore, geWeiScore);
            this.updateProgress();

            if (this._currentScore === 0 && this._finishCallBack) {
                this._finishCallBack(this);
                if (this._callBackExecuteOnce) {
                    this._finishCallBack = null;
                }
            }
        }
    }

    private updateScoreNumber(baiWei: number, shiWei: number, geWei: number) {
        if (baiWei == 0) {
            this._baiWei.node.active = false;
            if (shiWei == 0) {
                this._shiWei.node.active = false;
                this._geWei.node.setPosition(0, 0, 2.5);
            }
            else {
                this._shiWei.node.active = true;
                this._shiWei.node.setPosition(-1.1, 0, 2.5);
                this._geWei.node.setPosition(1.1, 0, 2.5);
            }
        }
        else {
            this._baiWei.node.active = true;
            this._shiWei.node.active = true;
            this._baiWei.node.setPosition(-2.2, 0, 2.5);
            this._shiWei.node.setPosition(0, 0, 2.5);
            this._geWei.node.setPosition(2.2, 0, 2.5);
        }

        this._baiWei.material = this._scoreMaterialArr[baiWei];
        this._shiWei.material = this._scoreMaterialArr[shiWei];
        this._geWei.material = this._scoreMaterialArr[geWei];
    }

    private updateProgress() {
        let scale = this._currentScore / this._maxScore;
        if (scale <= 0) scale = 0;
        this._progress.setScale(0.85, 1, 0.85 * (1 - scale));
        this._progress.setPosition(0, this._progress.position.y, 4 * scale);
    }

    public updateColor(value: boolean) {
        const miaobian_g = this.node.getChildByPath("Node/miaobian_g");
        if (miaobian_g) {
            miaobian_g.active = value;
        }
        const miaobian_b = this.node.getChildByPath("Node/miaobian_b");
        if (miaobian_b) {
            miaobian_b.active = !value;
        }
    }

    public updateScore(value: number) {
        this._putTime = game.totalTime;
        this._targetScore = value;
        this._targetScore = math.clamp(this._targetScore, 0, this._maxScore);
    }

    public setScore(value: number) {
        this._targetScore = value;
        this._targetScore = math.clamp(this._targetScore, 0, this._maxScore);
        this._currentScore = this._targetScore;
        this.updateScoreNumber(Math.floor(this._currentScore / 100 % 10), Math.floor(this._currentScore / 10 % 10), Math.floor(this._currentScore % 10));
        this.updateProgress();
    }

    public resetScore() {
        this.setScore(this._maxScore);
    }

    public close(callback?: () => void) {
        if (this._initScale) {
            this._initScale.set(this.node.scale);
        }
        else {
            this._initScale = this.node.scale.clone();
        }
        const targetScale = GlobalPool.Vec3Pool.alloc();
        Vec3.multiplyScalar(targetScale, this._initScale, 1.2);
        // this.node.getChildByName("Node").getChildByName("hei").active = false;
        tween(this.node)
            .to(0.3, { scale: targetScale }, { easing: 'quadInOut' })
            .to(0.1, { scale: Vec3.ZERO }, { easing: 'quadInOut' })
            .call(() => {
                GlobalPool.Vec3Pool.free(targetScale);
                callback && callback();
            })
            .start();
    }

    public open(callback?: () => void) {
        const initScale = this._initScale ? this._initScale : Vec3.ONE;
        const targetScale = GlobalPool.Vec3Pool.alloc();
        Vec3.multiplyScalar(targetScale, initScale, 1.2);
        this.node.scale = Vec3.ZERO;
        tween(this.node)
            .to(0.1, { scale: targetScale }, { easing: 'quadInOut' })
            .to(0.3, { scale: initScale }, { easing: 'quadInOut' })
            .call(() => {
                GlobalPool.Vec3Pool.free(targetScale);
                callback && callback();
            })
            .start();
    }

    public playScoreAnimation() {
        if (!this.node) {
            return;
        }
        this._scoreAnimation.play();
    }
}


