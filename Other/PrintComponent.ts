import { AudioSource, game, Vec3 } from "cc";
import { PlayableSDK } from "./PlayableSDK";

interface IVec3 {
    x?: number, y?: number, z?: number,
}
export enum PlayerAction {
    next = 'next',                              //点击next跳转商店
    again = 'again',                            //点击again跳转商店
    download = 'download',                      //点击download跳转商店
    automatic_jump = 'automatic_jump',          //自动跳转商店
    select_skill = 'select_skill',              //选择技能跳转商店
    play_now = 'playnow',                      //点击领取跳转商店
}

enum EventName {
    loading = 'loading',                        //loading结束时上报
    game_start = 'game_start',                  //点击开始游戏、拖动人物开始游戏、进入试玩立即开始游戏、点击again且再次游戏时上报
    game_end = 'game_end',                      //每次游戏结束，上报游戏结果
    voice_touch = 'voice_touch',                //首次触发touch-start和touch-end 上报
    voice_on = 'voice_on',                      //首次播放声音上报
    actionbar = 'actionbar',                    //因为点击按钮、自动跳转等行为导致页面跳转到商店时上报
    interrupt = 'interrupt',                    //因为点击跳转、弹窗跳转、页面切换、页面关闭等行为导致的页面关闭和不可见时，上报
    game_touch = 'game_touch',                  //游戏存在操作角色行为时上报，
    stuck = 'stuck',                            //游戏fps过低上报，
    game_event = 'game_event',                  //触发小兵融合、机关、功能卡、击杀小兵结果选择上报
    stutter = 'stutter',                        //最新fps打点
}

enum APPId {
    LastWar = "LW",
    TopHeros = "TH",
    TopWar = "TW",
}



export class PrintComponent {


    private static userId: string;

    private static uuid: string;

    //游戏开始时间
    private static startTime: number;

    //总计暂停时间
    private static totalPausedTime: number;

    //游戏开始后暂停时间
    private static gamePausedTime: number;

    //暂停时间戳
    private static lastPauseTime: number;

    //游戏开始时间戳
    public static lastGameStartTime: number;

    //累计游戏次数
    private static totalGamesPlayed: number;


    private static loaded = false;

    private static isPlaying: boolean;

    private static gameStarted: boolean;

    private static hasVoice_on = false;

    private static coordinate_old: IVec3 = {}

    private static coordinate_new: IVec3 = {}

    private static stage = 0;

    private static maxStage;

    public static init(maxStage = 1) {
        //初始化
        this.startTime = Date.now();
        this.totalPausedTime = 0;
        this.gamePausedTime = 0;
        this.lastPauseTime = 0;
        this.lastGameStartTime = 0;
        this.totalGamesPlayed = 1;
        this.isPlaying = false;
        this.gameStarted = false;
        this.userId = PlayableSDK.getUserId();
        this.uuid = PlayableSDK.getUUID();

        this.maxStage = maxStage;

        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
        console.log('Print init');


        // let playFunc = AudioSource.prototype.play;
        // AudioSource.prototype.play = function () {
        //     let t = this;
        //     playFunc.call(t);
        //     PrintComponent.voice_on();
        // }

        // this.hasVoice_on = false;
    }

    private static getUserId() {
        let canvas = window.document.getElementById('GameCanvas')

        // return this.hashString(canvas.toDataURL('image/png')).toString();
        return PlayableSDK.getUserId();
    }

    private static hashString(str) {
        let hash = 0;
        for (let char of str) {
            hash = (hash << 5) - hash + char.charCodeAt(0);
        }
        return hash;
    }

    public static getCurrentDuration() {
        return Date.now() - this.startTime - this.totalPausedTime;
    }

    /**
     * 上报事件
     */
    private static reportEvent(eventType: EventName, additionalParams = {}) {
        let params: any = {
            ...window.printParams,
            'user_id': this.userId,
            'uuid': this.uuid,
            'material': window.__material,
            'media': window.__PLATFORM,
            'appid': window.__appid,
            ...additionalParams,
            // 'debug_mode': true
        };
        if (!params.duration) {
            params.duration = this.getCurrentDuration();

        }


        //@ts-ignore
        if (eventType == EventName.stutter) {
            window.gtag && window.gtag('event', eventType, params)
            window.AF && window.AF('pba', 'event', { eventType: 'EVENT', eventValue: params, eventName: eventType })
        }
        else {
            window.AF && window.AF('pba', 'event', { eventType: 'EVENT', eventValue: params, eventName: eventType })
        }

        console.log("pba_log msg:", eventType, params)
    }

    /**
     * loading结束调用
     */
    public static loading() {
        if (this.loaded) {
            return;
        }
        this.reportEvent(EventName.loading);
        this.loaded = true;
    }

    /**
     * 游戏开始时调用
     */
    public static startGame(stageNum) {
        if (!this.isPlaying) {
            this.isPlaying = true;
            this.gameStarted = true;
            this.gamePausedTime = 0;
            this.lastGameStartTime = this.getCurrentDuration();
            this.coordinate_old.x = undefined;
            this.coordinate_old.y = undefined;
            this.coordinate_old.z = undefined;

            let stage: any = stageNum;
            if (stage == this.maxStage) {
                stage = 'final'
            }

            this.reportEvent(EventName.game_start, { stage, 'total_games_played': this.totalGamesPlayed });
        }
    }

    /**
     * 点击重新开始时调用
     */
    public static replay() {
        this.isPlaying = false
        ++this.totalGamesPlayed;
    }

    private static lastTouchType
    /**
     * 操作主角时调用
     * @param type type = "touch-start" | "touch-end"
     * @param pos 主角位置
     */
    public static game_interaction(type: string, pos: IVec3) {
        // if (this.lastTouchType == type) {
        //     return;
        // }
        if (!this.isPlaying) {
            return;
        }
        this.lastTouchType = type;
        this.coordinate_old.x = this.coordinate_new.x;
        this.coordinate_old.y = this.coordinate_new.y;
        this.coordinate_old.z = this.coordinate_new.z;
        this.coordinate_new.x = pos.x;
        this.coordinate_new.y = pos.y;
        this.coordinate_new.z = pos.z;

        this.reportEvent(EventName.game_touch, {
            type,
            coordinate_old_x: this.coordinate_old.x,
            coordinate_old_y: this.coordinate_old.y,
            coordinate_old_z: this.coordinate_old.z,
            coordinate_new_x: this.coordinate_new.x,
            coordinate_new_y: this.coordinate_new.y,
            coordinate_new_z: this.coordinate_new.z,
        });
    }

    public static game_event(param) {
        this.reportEvent(EventName.game_event, param);
    }

    /**
     * 游戏结束时调用
     */
    public static endGame(isWin, stageNum, level) {
        if (this.isPlaying) {
            this.isPlaying = false;
            let stage: any = stageNum;
            if (stage == this.maxStage) {
                stage = 'final'
            }

            let param: any = {
                stage,
                total_games_played: this.totalGamesPlayed,
                value: isWin ? 'win' : 'lose',
                game_duration: this.getCurrentDuration() - this.lastGameStartTime,
                type: level
            }

            this.reportEvent(EventName.game_end, param);
        }
    }

    /**
     * 首次触发touch-start和touch-end 上报
     * @param type type = "touch-start" | "touch-end"
     */
    public static voice_touch(type: string) {
        this.reportEvent(EventName.voice_touch, { type: type });
    }



    /**
     * 跳转到商店调用
     */
    public static actionbar(action: PlayerAction) {
        this.reportEvent(EventName.actionbar, { value: action });
    }

    /**
     * 首次播放声音调用
     */
    public static voice_on() {
        if (!this.hasVoice_on) {
            this.reportEvent(EventName.voice_on);
            this.hasVoice_on = true;
        }
    }

    private static stuckTime = 0;


    private static readonly stuckValue = 0.04;

    public static stuckTest(dt: number) {
        if (dt > this.stuckValue) {
            this.stuckStart(dt);
        } else {
            this.stuckEnd();
        }
    }

    private static stuckStart(dt: number) {
        this.stuckTime += dt;
    }

    private static stuckEnd() {
        if (this.stuckTime > 0) {
            this.reportEvent(EventName.stuck, { 'stuck_time': Math.floor(this.stuckTime * 1000) });
        }
        this.stuckTime = 0;
    }

    /**
     * interrupt事件 page_hidden
     */
    private static handleVisibilityChange() {
        if (document.hidden) {
            this.lastPauseTime = Date.now();
            const interruptType = this.isPlaying ? 'during_game' : (this.gameStarted ? 'after_game' : 'before_game');
            this.reportEvent(EventName.interrupt, { 'type': interruptType, 'value': 'page_hidden' });
        } else {
            if (this.lastPauseTime > 0) {
                let pauseTime = Date.now() - this.lastPauseTime;
                this.totalPausedTime += pauseTime;
                this.gamePausedTime += pauseTime;
                this.lastPauseTime = 0;
            }
        }
    }


    public static stutter(param): void {
        this.reportEvent(EventName.stutter, param);
    }
}
