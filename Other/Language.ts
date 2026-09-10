import { resources, sys } from "cc";

export class Language {
	private static languageCode = null;


	public static init(rootDir = null, endCall?) {
		if (!this.languageCode) {
			this.getLanguageCode();
		}

		if (!rootDir) {
			rootDir = 'texture/language';
		}
		resources.loadDir(rootDir + '/' + this.languageCode, () => {
			endCall && endCall();
		})
	}

	public static getLanguageCode() {
		if (this.languageCode) return this.languageCode;

		let code = sys.languageCode;
		// console.log('========', code)

		let codeNum = "";
		if (code == "zh" || code == "zh-cn") {
			codeNum = "zh";
		} else if (code == "de") {
			codeNum = "de";
		} else if (code == "ja") {
			codeNum = "ja";
		} else if (code == "fr") {
			codeNum = "fr";
		} else if (code == "zh-tw" || code == "zh-hk") {
			codeNum = "zh-tw";
		} else if (code == "en") {
			codeNum = "en";
		} else if (code == "ko") {
			codeNum = "ko";
		} else if (code == "ru") {
			codeNum = "ru";
		} else if (code == "ar") {
			codeNum = "ar";
		} else {
			codeNum = "en";
		}

		this.languageCode = codeNum;
		return this.languageCode;
	}
}