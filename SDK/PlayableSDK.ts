import { view } from 'cc';

interface PlayableHost {
    __PLATFORM?: string;
    volumeSwitch?: boolean;
    dapi?: { getAudioVolume?: () => number };
    wx?: { notifyMiniProgramPlayableStatus: (status: { isEnd: boolean }) => void };
    tt?: unknown;
    setLoadingProgress?: (progress: number) => void;
    GameConfs?: Record<string, unknown>;
    xsd_playable?: { adapter(): void; gameReady(): void; install(): void; gameEnd(): void; onInteracted(): void; download(): void };
    AnalyticsIns?: { onDisplay?(): void; onInstall?(type: string): void; trackCustomEvent?(name: string, params: Record<string, unknown>): void;
        onShowEndCard?(result: string): void; onRetry?(): void };
}

/** 平台权限是独立增益及暂停原因，不改玩家的主音量或 music/sfx 开关。 */
export interface PlatformAudioTarget {
    setPlatformVolume(volume: number): void;
    setSuspended(reason: string, value: boolean): void;
}

export enum PlatForm {
	Aarki = 'Aarki',
	AdColony = 'AdColony',
	Applovin = 'Applovin',
	Bigo = 'Bigo',
	Chartboost = 'Chartboost',
	Facebook = 'Facebook',
	Google = 'Google',
	Ironsource = 'Ironsource',
	Kwai = 'Kwai',
	Liftoff = 'Liftoff',
	Mintegral = 'Mintegral',
	Mytarget = 'Mytarget',
	Moloco = 'Moloco',
	Pangle = 'Pangle',
	Snapchat = 'Snapchat',
	Tapjoy = 'Tapjoy',
	Tiktok = 'Tiktok',
	Unity = 'Unity',
	Vungle = 'Vungle',

	Wechat = 'Wechat',
	Douyin = 'Douyin',

	Preview = 'Preview',
}

export class PlayableSDK {

	private static isFirstClick = false;
    private static get host(): PlayableHost {
        return typeof window === 'undefined' ? {} : window as unknown as PlayableHost;
    }

    /**
     * 保留现有渠道桥接：volumeSwitch、Ironsource dapi 百分比及 view.audioVolumeChange。
     * 事件接受 boolean 开关或 0..1 数值；调用者在服务释放前解绑。
     */
    static bindAudio(target: PlatformAudioTarget): () => void {
        let enabled = this.host.volumeSwitch !== false;
        let platformVolume = this.readAudioVolume();
        let disposed = false;
        const apply = (): void => {
            const gain = enabled ? platformVolume : 0;
            target.setPlatformVolume(gain);
            target.setSuspended('playable-sdk:muted', gain === 0);
        };
        const changed = (value: unknown): void => {
            if (disposed) return;
            if (typeof value === 'boolean') {
                enabled = value;
                platformVolume = this.readAudioVolume();
            } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
                platformVolume = value;
            } else return;
            apply();
        };
        apply();
        view.on('audioVolumeChange', changed);
        return () => {
            if (disposed) return;
            disposed = true;
            view.off('audioVolumeChange', changed);
        };
    }

    private static readAudioVolume(): number {
        if (this.platform !== PlatForm.Ironsource) return 1;
        try {
            const volume = this.host.dapi?.getAudioVolume?.();
            return typeof volume === 'number' && Number.isFinite(volume)
                ? Math.min(100, Math.max(0, volume)) / 100 : 1;
        } catch (error) {
            console.warn('[PlayableSDK] Cannot read platform audio volume', error);
            return 1;
        }
    }

	/**
	 * 渠道/平台
	 */
	static get platform(): PlatForm {
		if (this.host.__PLATFORM) {
			return (PlatForm as Record<string, PlatForm>)[this.host.__PLATFORM] || PlatForm.Preview;
		}

		if (this.host.wx) {
			return PlatForm.Wechat;
		} else if (this.host.tt) {
			return PlatForm.Douyin;
		}

		return PlatForm.Preview;
	}

	/**
	 * 隐藏加载进度
	 */
	static hideLoadingBar() {
        this.host.setLoadingProgress?.(100);
        this.host.AnalyticsIns?.onDisplay?.();
	}

	/**
	 * 由sdk传入的配置参数
	 * @param key 
	 * @returns 
	 */
	static getGameConfs(key: string): unknown {
        return this.host.GameConfs?.[key] ?? null;
	}

	/**
	 * 下载安装游戏
	 * @param type 跳转商店的类型，厂家不同，要求也不一样
	 */
	static download(type = 'download') {
		if (this.host.xsd_playable) {
			this.host.xsd_playable.download();
		}
		else if (PlayableSDK.platform === PlatForm.Wechat) {
			this.host.wx?.notifyMiniProgramPlayableStatus({ isEnd: true });
		}
		else if (PlayableSDK.platform === PlatForm.Douyin) {
			// 目前是30秒自动跳，没有主动跳转
		}

        this.host.AnalyticsIns?.onInstall?.(type);
	}

	/**
	 * 上报自定义事件，对于不同厂家的要求，均可以用这个来自己实现
	 * @param eventName 事件名称
	 * @param params 事件参数，字典对象
	 */
	static trackCustomEvent(eventName: string, params: Record<string, unknown>) {
        this.host.AnalyticsIns?.trackCustomEvent?.(eventName, params);
	}
	/**
	 * 当游戏进入结束状态（如显示得分、结算界面等）时调用
	 * @param result 本次游戏结果，通关win、通关失败lose
	 */
	static onShowEndCard(result = 'win') {
        this.host.AnalyticsIns?.onShowEndCard?.(result);
	}
	/**
	 * 当玩家点击重新开始游戏时调用
	 */
	static onRetry() {
        this.host.AnalyticsIns?.onRetry?.();
	}
	/////////////////////////////////////////////////////////////////


	static adapter() {
        this.host.xsd_playable?.adapter();
	}
	static gameReady() {
        this.host.xsd_playable?.gameReady();
	}
	static gameDownload() {
        this.host.xsd_playable?.install();
	}
	static gameEnd() {
        this.host.xsd_playable?.gameEnd();
	}
	static onInteracted() {
		if (!this.isFirstClick) {
			this.host.xsd_playable?.onInteracted();
			this.isFirstClick = true;
		}
	}
	static unicodeEncode(t: string) {
		for (var e = "", o = 0; o < t.length; o++) {
			var n = t.charCodeAt(o);
			e += "\\u" + this.padLeft(n.toString(16), "0", 4)
		}
		return e
	}
	static unicodeDecode(t: string) {
		return t.replace(/\\u([\d\w]{4})/gi, function (_match: string, e: string) {
			return String.fromCharCode(parseInt(e, 16))
		})
	}
	static padLeft(t: string, e: string, o: number) {
		for (; t.length < o;) t = e + t;
		return t
	}

	static androidUrl = ""
	static iosUrl = ""
}


