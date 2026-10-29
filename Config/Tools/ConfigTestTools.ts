import type { ConfigPlugin } from '../ConfigSetup';
import type { ConfigStore } from '../ConfigStore';
import { ConfigError } from '../ConfigTypes';
import { ConfigDebugPanel, ConfigPanelOptions } from './ConfigDebugPanel';
import { ConfigStorage, ConfigTestSession } from './ConfigTestSession';

/** 测试工具选项：存储与链接可注入；panel 为 false 时只提供保存与链接复现，不创建面板。 */
export interface ConfigTestToolsOptions {
    storage?: ConfigStorage | null;
    url?: string;
    panel?: boolean | ConfigPanelOptions;
}

/**
 * 把测试会话与调试面板接入配置启动流程的插件：启动前恢复本地与链接层，启动后创建面板。
 * 正式版本不创建本插件即可，核心不会读取本地缓存或链接；同一实例只接入一个运行实例。
 */
export class ConfigTestTools implements ConfigPlugin {
    private sessionValue: ConfigTestSession | null = null;
    private panelValue: ConfigDebugPanel | null = null;

    /** 保存选项；会话与面板在接入启动流程时创建。 */
    constructor(private readonly options: ConfigTestToolsOptions = {}) {}

    /** 测试会话；启动前为空。 */
    get session(): ConfigTestSession | null { return this.sessionValue; }
    /** 调试面板；未启动或 panel 为 false 时为空。 */
    get panel(): ConfigDebugPanel | null { return this.panelValue; }

    /** 创建测试会话并在重启参数锁定前恢复本地与链接层，返回逐项提示。 */
    beforeStart(store: ConfigStore): readonly string[] {
        if (this.sessionValue) throw new ConfigError(['同一测试工具只能接入一个配置运行实例']);
        this.sessionValue = new ConfigTestSession(store, { storage: this.options.storage, url: this.options.url });
        return this.sessionValue.restore();
    }

    /** 按选项创建面板；挂载由项目在界面就绪后调用 mount。 */
    afterStart(): void {
        const panel = this.options.panel ?? true;
        if (panel !== false && this.sessionValue) this.panelValue = new ConfigDebugPanel(this.sessionValue, panel === true ? {} : panel);
    }

    /** 挂载面板入口；没有面板或没有 DOM 时返回 false。 */
    mount(): boolean { return this.panelValue ? this.panelValue.mount() : false; }

    /** 销毁面板并断开会话；不清除用户保存的测试数据。 */
    dispose(): void {
        this.panelValue?.dispose();
        this.panelValue = null; this.sessionValue = null;
    }
}
