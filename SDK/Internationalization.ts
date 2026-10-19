import { resources } from 'cc';
import { Label } from 'cc';
import { UITransform } from 'cc';
import { Sprite } from 'cc';
import { _decorator, Component, Node } from 'cc';
import { SpriteFrame, sys } from 'cc';
import { PlatForm, PlayableSDK } from './PlayableSDK';
import { PlatformCheck } from './PlatformCheck';
const { ccclass, property } = _decorator;

@ccclass('InternationalizationLabelConfig')
export class InternationalizationLabelConfig {

    @property({ displayName: "简中" })
    zh_s: string = '';
    @property({ displayName: "繁中" })
    zh_c: string = '';
    @property({ displayName: "英语" })
    en: string = '';
    @property({ displayName: "意呆利语" })
    it: string = '';
    @property({ displayName: "西班牙语" })
    es: string = '';
    @property({ displayName: "风车语" })
    du: string = '';
    @property({ displayName: "匈牙利语" })
    hu: string = '';
    @property({ displayName: "葡萄牙语" })
    pt: string = '';
    @property({ displayName: "挪威语" })
    no: string = '';
    @property({ displayName: "波兰语" })
    pl: string = '';
    @property({ displayName: "大肉串语" })
    tr: string = '';
    @property({ displayName: "乌克兰语" })
    uk: string = '';
    @property({ displayName: "罗马尼亚语" })
    ro: string = '';
    @property({ displayName: "保加利亚语" })
    bg: string = '';
    @property({ displayName: "阿三语" })
    hi: string = '';
    @property({ displayName: "未知" })
    unknown: string = '';
    @property({ displayName: "白旗语" })
    fr: string = '';
    @property({ displayName: "小胡子语" })
    de: string = '';
    @property({ displayName: "俄语" })
    ru: string = '';
    @property({ displayName: "八嘎语" })
    ja: string = '';
    @property({ displayName: "大户语" })
    ar: string = '';
    @property({ displayName: "西巴语" })
    ko: string = '';
    @property({ displayName: "猴语" })
    vi: string = '';


    protected string_map: { [key: string]: string } = null;
    public get_string(): string {
        if (this.string_map == null) {
            this.set_map();
        }
        return PlayableSDK.platform == PlatForm.Wechat ? this.string_map['zh-s'] : is_null_string(this.string_map[Language.language]) ? this.string_map['en'] : this.string_map[Language.language];
    }

    set_map() {
        this.string_map = {};
        this.string_map['zh-s'] = this.zh_s;
        this.string_map['zh-c'] = this.zh_c;
        this.string_map['en'] = this.en;
        this.string_map['it'] = this.it;
        this.string_map['es'] = this.es;
        this.string_map['du'] = this.du;
        this.string_map['hu'] = this.hu;
        this.string_map['pt'] = this.pt;
        this.string_map['no'] = this.no;
        this.string_map['pl'] = this.pl;
        this.string_map['tr'] = this.tr;
        this.string_map['uk'] = this.uk;
        this.string_map['ro'] = this.ro;
        this.string_map['bg'] = this.bg;
        this.string_map['hi'] = this.hi;
        this.string_map['unknown'] = this.unknown;
        this.string_map['fr'] = this.fr;
        this.string_map['de'] = this.de;
        this.string_map['ru'] = this.ru;
        this.string_map['ja'] = this.ja;
        this.string_map['ar'] = this.ar;
        this.string_map['ko'] = this.ko;
        this.string_map['vi'] = this.vi;
    }
}


export class Language {
    private static code = null;

    public static get language() {
        if (this.code) return this.code;
        let code = "";
        switch (sys.languageCode) {
            //繁中
            case 'zh-tw':
            case 'zh-hk':
                code = 'zh-c';
                break;
            //简中
            case 'zh':
            case 'zh-cn':
            case 'zh_CN':
                code = 'zh-s';
                break;
            //未知
            case 'unknown':
                code = 'en';
                break;
            default:
                if (sys.languageCode.includes('-')) {
                    code = sys.languageCode.split("-")[0];
                } else {
                    code = sys.languageCode;
                }
                break;
        }
        this.code = code;
        return this.code;
    }
}

@ccclass('Internationalization')
export class Internationalization extends Component {

    @property({ type: InternationalizationLabelConfig, displayName: "文本配置", visible: function (this) { return this.getComponent(Label) != null } })
    string_config: InternationalizationLabelConfig = new InternationalizationLabelConfig();

    protected onLoad(): void {
        if (this.getComponent(PlatformCheck)) return;
        let sprite = this.node.getComponent(Sprite);
        if (!sprite) {
            let label = this.getComponent(Label);
            if (label) {
                label.string = this.string_config.get_string();
            }
            return;
        }
        let scale = this.node.scale.clone();
        let size = sprite.getComponent(UITransform).contentSize.clone();
        let uuid = sprite.spriteFrame.uuid;
        let info: any = resources.getAssetInfo(uuid);
        let language_code = Language.language;
        if (info && info.path) {
            let path: string = info.path;
            path = path.replace('/en/', '/' + (PlayableSDK.platform == PlatForm.Wechat ? 'zh-s' : language_code) + '/');
            let sprite_frame = resources.get(path, SpriteFrame);
            if (sprite_frame) {
                sprite.spriteFrame = sprite_frame;
                let new_size = sprite.getComponent(UITransform).contentSize.clone();
                let _w = size.width / new_size.width, _h = size.height / new_size.height;
                this.node.scale = scale.clone().multiplyScalar(Math.min(_w, _h));
                if (this.node.scale.x > scale.x || this.node.scale.y > scale.y) {
                    this.node.scale = scale;
                }
            } else {
                resources.load(path, SpriteFrame, (err, res) => {
                    if (res) {
                        sprite.spriteFrame = res;
                        let new_size = sprite.getComponent(UITransform).contentSize.clone();
                        let _w = size.width / new_size.width, _h = size.height / new_size.height;
                        this.node.scale = scale.clone().multiplyScalar(Math.min(_w, _h));
                        if (this.node.scale.x > scale.x || this.node.scale.y > scale.y) {
                            this.node.scale = scale;
                        }
                    }
                });
            }
        }
    }

}

export function is_null_string(str?: string | null): str is '' | 'null' | 'Null' | null | undefined {
    return !str
        || str.length === 0
        || str === 'null'
        || str === 'Null';
}