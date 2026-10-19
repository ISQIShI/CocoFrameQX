import { _decorator, Component, Node } from 'cc';
import { ccenum } from 'cc';
import { Animation } from 'cc';
import { Sprite } from 'cc';
import { resources } from 'cc';
import { SpriteFrame } from 'cc';
import { UITransform } from 'cc';
import { PlatForm, PlayableSDK } from './PlayableSDK';
const { ccclass, property } = _decorator;


/**
 * 针对各平台的处理
 * 微信平台强制使用简中
 * google平台不允许出现手和箭头引导(拖动移动等)，按钮不允许使用动效，跳转按钮强制使用Play Now
 * 针对google平台的设置允许多选
 */

export enum GooglePlatform {
    Animation, Visable, Sprite, Shader, Component
}
ccenum(GooglePlatform)

@ccclass('PlatformCheck')
export class PlatformCheck extends Component {

    @property({ type: [GooglePlatform], displayName: "Google专项", tooltip: 'Animation会销毁自身Animation组件,Visable会禁用节点显示,Sprite会强制更换精灵为Play Now,Shader会设置着色器speedScale属性,Component由于判定问题暂时不可用' })
    googlePlatform: GooglePlatform[] = [];
    @property({ displayName: "en/PlayNow的路径", visible: function (this) { return this.googlePlatform == GooglePlatform.Sprite } })
    path: string = '';

    protected async onLoad() {

        if (PlayableSDK.platform == PlatForm.Google) {
            //google平台处理
            for (let i = 0; i < this.googlePlatform.length; i++) {
                switch (this.googlePlatform[i]) {
                    case GooglePlatform.Animation:
                        //禁用动画
                        this.getComponent(Animation).destroy();
                        break;
                    case GooglePlatform.Visable:
                        //禁用节点显示
                        this.node.active = false;
                        break;
                    case GooglePlatform.Sprite:
                        //强制更换精灵为Play Now
                        let scale = this.node.scale.clone();
                        let size = this.getComponent(UITransform).contentSize.clone();
                        let spf = resources.get(`${this.path}/spriteFrame`, SpriteFrame);
                        if (spf) {
                            this.getComponent(Sprite).spriteFrame = spf;
                            let new_size = this.getComponent(UITransform).contentSize.clone();
                            this.node.scale = scale.clone().multiplyScalar(size.width / new_size.width);
                            if (this.node.scale.x > scale.x) {
                                this.node.scale = scale;
                            }
                        } else {
                            resources.load(`${this.path}/spriteFrame`, SpriteFrame, (err, res) => {
                                if (res) {
                                    this.getComponent(Sprite).spriteFrame = res;
                                    let new_size = this.getComponent(UITransform).contentSize.clone();
                                    this.node.scale = scale.clone().multiplyScalar(size.width / new_size.width);
                                    if (this.node.scale.x > scale.x) {
                                        this.node.scale = scale;
                                    }
                                }
                            });
                        }
                        break;
                    case GooglePlatform.Shader:
                        //设置着色器speedScale属性为0
                        this.getComponent(Sprite).getMaterialInstance(0).setProperty('speedScale', 0);
                        break;
                    case GooglePlatform.Component:
                        //销毁所有Component组件(自身除外),如何判定是否为系统组件
                        let components = this.node.getComponents(Component);
                        // for (let j = 0; j < components.length; j++) {
                        //     let component_name = components[j].name.replace(`${this.node.name}<`,'');
                        //     component_name = component_name.replace('>','');
                        //     if(component_name in cc) continue;
                        //     if (components[j] != this) {
                        //         components[j].destroy();
                        //     }
                        // }
                        break;
                }
            }
        } else if (PlayableSDK.platform == PlatForm.Wechat) {
            //微信平台处理，默认强制关闭显示
            this.node.active = false;
        }
    }

}
