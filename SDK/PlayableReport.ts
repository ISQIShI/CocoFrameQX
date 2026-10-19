import { _decorator, Component, Node } from 'cc';
import { PlayableSDK } from './PlayableSDK';
const { ccclass, property } = _decorator;

@ccclass('PlayableReport')
export class PlayableReport extends Component {

    static isReport0: boolean = false;
    static isReport25: boolean = false;
    static isReport50: boolean = false;
    static isReport75: boolean = false;
    static isReport100: boolean = false;
    static isRetry: boolean = false;
    static isFailed: boolean = false;
    static isEndCardShow: boolean = false;
    static isCTAClicked: boolean = false;

    protected onLoad(): void {
        PlayableReport.Init();
    }

    static Init() {
        this.isReport0 = false;
        this.isReport25 = false;
        this.isReport50 = false;
        this.isReport75 = false;
        this.isReport100 = false;
        this.isRetry = false;
        this.isFailed = false;
        this.isEndCardShow = false;
        this.isCTAClicked = false;
    }

    static ReportProgress(progress: number) {
        const eventName = `CHALLENGE_PASS_${progress}`;
        PlayableSDK.trackCustomEvent(eventName, { progress: progress })
        console.log(eventName);
    }

    //打点 0%
    static Report_0() {
        if (this.isReport0)
            return;
        this.isReport0 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_STARTED', { progress: 0 })
        console.log("CHALLENGE_STARTED");
    }

    //打点 25%
    static Report_25() {
        if (this.isReport25)
            return;
        this.isReport25 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_PASS_25', { progress: 25 })
        console.log("CHALLENGE_PASS_25");
    }

    //打点 50%
    static Report_50() {
        if (this.isReport50)
            return;
        this.isReport50 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_PASS_50', { progress: 50 })
        console.log("CHALLENGE_PASS_50");
    }

    //打点 75%
    static Report_75() {
        if (this.isReport75)
            return;
        this.isReport75 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_PASS_75', { progress: 75 })
        console.log("CHALLENGE_PASS_75");
    }

    //打点 100%
    static Report_100() {
        if (this.isReport100)
            return;
        this.isReport100 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_SOLVED', { progress: 100 })
        console.log("CHALLENGE_SOLVED");
    }
    //失败
    static Report_Failed() {
        if (this.isReport100)
            return;
        this.isReport100 = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_FAILED', { progress: 100 })
        console.log("CHALLENGE_FAILED");
    }
    //重试
    static Report_Retry() {
        if (this.isRetry)
            return;
        this.isRetry = true;
        PlayableSDK.trackCustomEvent('CHALLENGE_RETRY', { progress: 100 })
        console.log("CHALLENGE_RETRY");
    }
    //落版
    static Report_EndCardShow() {
        if (this.isEndCardShow)
            return;
        this.isEndCardShow = true;
        PlayableSDK.trackCustomEvent('ENDCARD_SHOW', { progress: 100 })
        console.log("ENDCARD_SHOW");
    }
    //点击CTA下载
    static Report_CTA_Clicked() {
        if (this.isCTAClicked)
            return;
        this.isCTAClicked = true;
        PlayableSDK.trackCustomEvent('CTA_CLICKED', { progress: 100 })
        console.log("CTA_CLICKED");
    }
}


