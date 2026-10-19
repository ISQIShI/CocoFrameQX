declare var window;

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

	/**
	 * 渠道/平台
	 */
	static get platform(): PlatForm {
		if ('__PLATFORM' in window) {
			if (window.__PLATFORM) return PlatForm[window.__PLATFORM];
		}

		if (window.wx) {
			return PlatForm.Wechat;
		} else if (window.tt) {
			return PlatForm.Douyin;
		}

		return PlatForm.Preview;
	}

	/**
	 * 隐藏加载进度
	 */
	static hideLoadingBar() {
		if (window.setLoadingProgress) {
			window.setLoadingProgress(100);
		}
		if (window.AnalyticsIns && window.AnalyticsIns.onDisplay) {
			window.AnalyticsIns.onDisplay();
		}
	}

	/**
	 * 由sdk传入的配置参数
	 * @param key 
	 * @returns 
	 */
	static getGameConfs(key) {
		if ('GameConfs' in window) {
			return window.GameConfs[key];
		} else {
			return null;
		}
	}

	/**
	 * 下载安装游戏
	 * @param type 跳转商店的类型，厂家不同，要求也不一样
	 */
	static download(type = 'download') {
		if (window.xsd_playable) {
			window.xsd_playable.download();
		}
		else if (PlayableSDK.platform === PlatForm.Wechat) {
			window.wx.notifyMiniProgramPlayableStatus({ isEnd: true });
		}
		else if (PlayableSDK.platform === PlatForm.Douyin) {
			// 目前是30秒自动跳，没有主动跳转
		}

		if (window.AnalyticsIns && window.AnalyticsIns.onInstall) {
			window.AnalyticsIns.onInstall(type);
		}
	}

	////////////// 上报打点数据接口，所有接口都需要实现 /////////////////////////////////////
	////////下面这3个函数在框架会自动调用
	private static onInitPlayable(): void { }	//可玩广告启动
	private static onLoaded(): void { }	//资源加载完成
	private static onCompleted() { }  //当用户关闭页面或离开可试玩广告时调用
	//////// 这两个函数在PlayableSDK中自动调用
	private static onDisplay(): void { }  // 加载完显示也是游戏开始
	private static onInstall(type) { };  //下载安装

	/**
	 * 上报自定义事件，对于不同厂家的要求，均可以用这个来自己实现
	 * @param eventName 事件名称
	 * @param params 事件参数，字典对象
	 */
	static trackCustomEvent(eventName, params) {
		if (window.AnalyticsIns) {
			window.AnalyticsIns.trackCustomEvent(eventName, params);
		}
	}
	/**
	 * 当游戏进入结束状态（如显示得分、结算界面等）时调用
	 * @param result 本次游戏结果，通关win、通关失败lose
	 */
	static onShowEndCard(result = 'win') {
		if (window.AnalyticsIns) {
			window.AnalyticsIns.onShowEndCard(result)
		}
	}
	/**
	 * 当玩家点击重新开始游戏时调用
	 */
	static onRetry() {
		if (window.AnalyticsIns) {
			window.AnalyticsIns.onRetry()
		}
	}
	/////////////////////////////////////////////////////////////////


	static adapter() {
		window.xsd_playable && window.xsd_playable.adapter()
	}
	static gameReady() {
		window.xsd_playable && window.xsd_playable.gameReady()
	}
	static gameDownload() {
		window.xsd_playable && window.xsd_playable.install()
	}
	static gameEnd() {
		window.xsd_playable && window.xsd_playable.gameEnd()
	}
	static onInteracted() {
		if (!this.isFirstClick) {
			window.xsd_playable && window.xsd_playable.onInteracted();
			this.isFirstClick = true;
		}
	}
	static unicodeEncode(t) {
		for (var e = "", o = 0; o < t.length; o++) {
			var n = t.charCodeAt(o);
			e += "\\u" + this.padLeft(n.toString(16), "0", 4)
		}
		return e
	}
	static unicodeDecode(t) {
		return t.replace(/\\u([\d\w]{4})/gi, function (t, e) {
			return String.fromCharCode(parseInt(e, 16))
		})
	}
	static padLeft(t, e, o) {
		for (; t.length < o;) t = e + t;
		return t
	}

	static androidUrl = ""
	static iosUrl = ""
}


