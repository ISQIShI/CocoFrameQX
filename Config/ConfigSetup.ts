import type { ConfigDefinition, ConfigTree, ConfigTreeValues } from './ConfigDefinition';
import { ConfigDebugPanel } from './ConfigDebugPanel';
import { ConfigSnapshot, ConfigStore } from './ConfigStore';
import { ConfigStorage, ConfigTestSession } from './ConfigTestSession';
import { ConfigError, ConfigMigration, ConfigRecord, ConfigSchema, ConfigValue } from './ConfigTypes';

/** 测试工具选项：开关由项目显式决定，存储与链接可注入。 */
export interface ConfigTestToolOptions {
    enabled: boolean;
    storage?: ConfigStorage | null;
    url?: string;
    onPanelVisibilityChange?: (visible: boolean) => void;
}

/** 容器读取接口，扩展只需按键读取生效值。 */
export interface ConfigReader { get(key: string): ConfigValue }

/** 启动扩展：补充扁平字段，在容器启动后应用生效值，实时字段变化时按变化键更新，退出时恢复原状。 */
export interface ConfigExtension {
    readonly schema: ConfigSchema;
    apply(store: ConfigReader): void;
    /** 启动后生效值变化时调用，先于 onChange 监听；changed 为本次生效值变化的全部键。 */
    update?(store: ConfigReader, changed: readonly string[]): void;
    restore(): void;
}

/** 跨字段校验：values 为定义的嵌套值，flat 含扩展字段在内的全部扁平值。 */
export type ConfigValidator<T> = (values: ConfigTreeValues<T>, flat: ConfigRecord) => readonly string[];

/** 启动完成后的配置运行实例，持有容器、测试会话与面板；读取值通过 definition.values。 */
export class ConfigRuntime<T extends ConfigTree> {
    private disposed = false;
    /** 由 ConfigSetup.start 创建。 */
    constructor(readonly definition: ConfigDefinition<T>, readonly store: ConfigStore, readonly session: ConfigTestSession,
        readonly panel: ConfigDebugPanel, readonly warnings: readonly string[], private readonly cleanup: () => void) {}
    /** 幂等释放：解除订阅、销毁面板、恢复扩展写入的原值并释放定义接入；不清除用户保存的测试数据。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cleanup();
    }
}

/**
 * 链式启动配置。start 按固定顺序执行：创建容器 → 项目层 → 本地与链接 → 锁定重启参数
 * → 接入定义 → 应用扩展 → 订阅；调用方无需记忆初始化顺序。
 */
export class ConfigSetup<T extends ConfigTree> {
    private readonly extensions: ConfigExtension[] = [];
    private readonly validators: ConfigValidator<T>[] = [];
    private readonly listeners: ((snapshot: ConfigSnapshot) => void)[] = [];
    private migration: ConfigMigration | undefined;
    private projectInput: unknown = undefined;
    private tools: ConfigTestToolOptions = { enabled: false };
    private listenerError: ((error: unknown) => void) | undefined;

    /** 由 definition.setup 创建。 */
    constructor(readonly definition: ConfigDefinition<T>, readonly project: string, readonly version: number) {}

    /** 追加扩展字段及其应用逻辑；空值忽略，便于可选扩展直接传入。 */
    extend(extension: ConfigExtension | null | undefined): this { if (extension) this.extensions.push(extension); return this; }
    /** 追加跨字段校验，可多次调用。 */
    validate(validator: ConfigValidator<T>): this { this.validators.push(validator); return this; }
    /** 设置旧版本文档迁移函数。 */
    migrate(migration: ConfigMigration): this { this.migration = migration; return this; }
    /** 设置项目层文档（如 JsonAsset.json）；空值表示没有项目文件。 */
    projectDocument(document: unknown): this { this.projectInput = document === null ? undefined : document; return this; }
    /** 设置测试工具开关、存储、链接和面板可见性回调。 */
    testTools(options: ConfigTestToolOptions): this { this.tools = { ...options }; return this; }
    /** 订阅启动后的配置变化，可多次调用。 */
    onChange(listener: (snapshot: ConfigSnapshot) => void): this { this.listeners.push(listener); return this; }
    /** 设置监听异常处理函数。 */
    onListenerError(handler: (error: unknown) => void): this { this.listenerError = handler; return this; }

    /** 完成启动并返回运行实例；任何一步失败都撤销已完成的接入后抛出。 */
    start(): ConfigRuntime<T> {
        const schema: ConfigSchema = Object.create(null);
        for (const source of [this.definition.schema, ...this.extensions.map(extension => extension.schema)]) {
            for (const key of Object.keys(source)) {
                if (Object.prototype.hasOwnProperty.call(schema, key)) throw new ConfigError(['配置键重复声明：' + key]);
                schema[key] = source[key];
            }
        }
        const validators = this.validators.slice(), definition = this.definition;
        const store = new ConfigStore({ project: this.project, version: this.version, schema,
            migrate: this.migration, onListenerError: this.listenerError,
            validate: flat => {
                if (!validators.length) return [];
                const nested = definition.read(flat);
                return validators.reduce<string[]>((issues, validator) => issues.concat(validator(nested, flat)), []);
            } });
        const warnings: string[] = [];
        if (this.projectInput !== undefined) warnings.push(...store.importDocument(this.projectInput, '项目').map(text => '项目配置：' + text));
        const session = new ConfigTestSession(store, { enabled: this.tools.enabled, storage: this.tools.storage, url: this.tools.url });
        warnings.push(...session.restore());
        store.start();
        const release = definition.attach(store);
        const applied: ConfigExtension[] = [];
        try { for (const extension of this.extensions) { applied.push(extension); extension.apply(store); } }
        catch (error) {
            for (const extension of applied.reverse()) extension.restore();
            release(); throw error;
        }
        const panel = new ConfigDebugPanel(session, { onVisibilityChange: this.tools.onPanelVisibilityChange });
        const unsubscribers = applied.filter(extension => extension.update)
            .map(extension => store.subscribe(snapshot => { if (snapshot.changed.length) extension.update!(store, snapshot.changed); }))
            .concat(this.listeners.map(listener => store.subscribe(listener)));
        return new ConfigRuntime(definition, store, session, panel, Object.freeze(warnings), () => {
            unsubscribers.forEach(unsubscribe => unsubscribe()); panel.dispose();
            for (const extension of applied.slice().reverse()) extension.restore();
            release();
        });
    }
}
