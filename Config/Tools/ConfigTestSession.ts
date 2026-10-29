import { CONFIG_TEXT_LIMIT, ConfigStore } from '../ConfigStore';
import { ConfigError } from '../ConfigTypes';

/** 最小本地存储接口，可由浏览器存储、Cocos sys.localStorage 或测试替身实现。 */
export interface ConfigStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** 存储与链接可注入；缺省时读取浏览器的 localStorage 与当前地址。 */
export interface ConfigTestOptions {
    storage?: ConfigStorage | null;
    url?: string;
}

/**
 * 测试配置的保存和分享适配器，建立在配置核心之上，核心不依赖它。没有网络请求，不读取任意远端 JSON，也不直接操作游戏。
 * 创建即启用：正式版本由项目不创建它（或不接入 ConfigTestTools），本地缓存与链接便不会被读取。
 * 不依赖引擎；网页环境只在构造时按需访问，存储不可用时仍可本次调参。
 */
export class ConfigTestSession {
    readonly storageKey: string;
    readonly panelRequested: boolean;
    private readonly storage: ConfigStorage | null;
    private readonly url: URL | null;
    private readonly startupIssues: string[] = [];
    private restored = false;

    /** 绑定一个项目容器，按项目隔离本地缓存；版本差异由文档版本号与迁移处理。 */
    constructor(readonly store: ConfigStore, options: ConfigTestOptions = {}) {
        this.storageKey = 'qx-config:' + encodeURIComponent(store.project);
        let storage: ConfigStorage | null = null, url: URL | null = null;
        try {
            storage = options.storage !== undefined ? options.storage : typeof window !== 'undefined' ? window.localStorage : null;
        } catch { this.startupIssues.push('浏览器禁止本地存储，本次仍可调参及导出'); }
        try {
            const value = options.url ?? (typeof window !== 'undefined' ? window.location.href : '');
            url = value ? new URL(value) : null;
        } catch { this.startupIssues.push('测试链接不是有效的绝对地址，已忽略链接配置'); }
        this.storage = storage; this.url = url;
        this.panelRequested = url?.searchParams.get('qxConfig') === '1';
    }

    /**
     * 在 store.start 和游戏创建之前恢复本地及链接配置；错误逐项返回，保留上一有效层。
     * 宽松导入跳过的未知键或非法字段同样作为提示返回，其余有效值照常应用。
     */
    restore(): readonly string[] {
        if (this.restored) return [];
        if (this.store.snapshot().started) throw new ConfigError(['请在游戏启动及配置 start 之前恢复测试参数']);
        this.restored = true;
        const issues = [...this.startupIssues];
        try {
            const saved = this.storage?.getItem(this.storageKey);
            if (saved !== null && saved !== undefined) issues.push(...this.store.importDocument(saved, '本地').map(text => '本地配置：' + text));
        } catch (error) { issues.push('本地配置未应用：' + message(error)); }
        try {
            const text = this.url?.searchParams.get('qxValues');
            if (text !== null && text !== undefined) issues.push(...this.store.importDocument(text, '会话').map(item => '链接配置：' + item));
        } catch (error) { issues.push('链接配置未应用：' + message(error)); }
        return issues;
    }

    /** 将相对项目基准的改动保存到本浏览器；失败时明确报错，不伪造保存成功。 */
    save(): void {
        if (!this.storage) throw new ConfigError(['当前环境没有可用的本地存储，请导出 JSON 保存']);
        const text = this.store.exportJSON('改动');
        if (text.length > CONFIG_TEXT_LIMIT) throw new ConfigError(['配置超过本地恢复的 64K 字符限制，请缩减配置']);
        try { this.storage.setItem(this.storageKey, text); }
        catch { throw new ConfigError(['本地保存失败，可能存储空间不足或访问被禁止，请导出 JSON']); }
    }

    /** 清除本次及本地覆盖，回到项目文件和默认值；不触发游戏重开或刷新网页。 */
    reset(): readonly string[] {
        this.store.replaceLayers({ 本地: {}, 会话: {} });
        const issues: string[] = [];
        try { this.storage?.removeItem(this.storageKey); }
        catch { issues.push('本次覆盖已清除，但删除本地缓存失败，下次打开可能仍会读取旧值'); }
        if (this.url?.searchParams.has('qxValues'))
            issues.push('当前地址仍含链接覆盖；再次打开请移除 qxValues，或使用导出的新链接');
        return issues;
    }

    /** 生成携带相对项目基准改动的复现链接；不访问网络、不自动复制或跳转。 */
    shareURL(): string {
        if (!this.url || ['http:', 'https:'].indexOf(this.url.protocol) === -1)
            throw new ConfigError(['复现链接需要通过 HTTP 或 HTTPS 打开的测试页面，请改用 JSON']);
        const result = new URL(this.url.href);
        result.searchParams.set('qxConfig', '1');
        result.searchParams.set('qxValues', JSON.stringify(this.store.exportDocument('改动')));
        if (result.href.length > 8000) throw new ConfigError(['配置链接过长，请使用 JSON 文件复现']);
        return result.href;
    }
}

/** 将未知异常转换为可展示的中文上下文文本，不假设异常一定为 Error。 */
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
