import type { ConfigDefinition, ConfigTree, ConfigTreeValues } from './ConfigDefinition';
import { ConfigSnapshot, ConfigStore } from './ConfigStore';
import { ConfigError, ConfigGroupInfo, ConfigMigration, ConfigRecord, ConfigSchema, ConfigValue } from './ConfigTypes';

/** 容器读取接口，扩展只需按键读取生效值。 */
export interface ConfigReader { get(key: string): ConfigValue }

/** 启动扩展：补充扁平字段，在容器启动后应用生效值，实时字段变化时按变化键更新，退出时恢复原状。 */
export interface ConfigExtension {
    readonly schema: ConfigSchema;
    /** 补充的分组；与定义或其他扩展同键时标题必须一致，视为同一分组。 */
    readonly groups?: readonly ConfigGroupInfo[];
    apply(store: ConfigReader): void;
    /** 启动后生效值变化时调用，先于 onChange 监听；changed 为本次生效值变化的全部键。 */
    update?(store: ConfigReader, changed: readonly string[]): void;
    restore(): void;
}

/**
 * 启动插件：在启动流程的固定时机接入附加功能（如测试会话、调试面板）。
 * 核心只调用此接口，不依赖任何插件实现；不需要的功能不注册即可。
 */
export interface ConfigPlugin {
    /** 项目层已导入、重启参数锁定前调用，可写入本地或会话层；返回的提示并入运行实例的 warnings。 */
    beforeStart?(store: ConfigStore): readonly string[] | void;
    /** 定义已接入、扩展已应用、订阅已建立后调用。 */
    afterStart?(store: ConfigStore): void;
    /** 运行实例释放或启动失败时按注册逆序调用。 */
    dispose?(): void;
}

/** 跨字段校验：values 为定义的嵌套值，flat 含扩展字段在内的全部扁平值。 */
export type ConfigValidator<T> = (values: ConfigTreeValues<T>, flat: ConfigRecord) => readonly string[];

/** 启动完成后的配置运行实例，持有定义与容器；读取值通过 definition.values。 */
export class ConfigRuntime<T extends ConfigTree> {
    private disposed = false;
    /** 由 ConfigSetup.start 创建。 */
    constructor(readonly definition: ConfigDefinition<T>, readonly store: ConfigStore, readonly warnings: readonly string[],
        private readonly cleanup: () => void) {}
    /** 幂等释放：解除订阅、释放插件、恢复扩展写入的原值并释放定义接入；不清除用户保存的测试数据。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cleanup();
    }
}

/**
 * 链式启动配置。start 按固定顺序执行：合并字段 → 创建容器 → 项目层 → 插件启动前
 * → 锁定重启参数 → 接入定义 → 应用扩展 → 订阅 → 插件启动后；调用方无需记忆初始化顺序。
 */
export class ConfigSetup<T extends ConfigTree> {
    private readonly extensions: ConfigExtension[] = [];
    private readonly plugins: ConfigPlugin[] = [];
    private readonly validators: ConfigValidator<T>[] = [];
    private readonly listeners: ((snapshot: ConfigSnapshot) => void)[] = [];
    private migration: ConfigMigration | undefined;
    private projectInput: unknown = undefined;
    private listenerError: ((error: unknown) => void) | undefined;

    /** 由 definition.setup 创建。 */
    constructor(readonly definition: ConfigDefinition<T>, readonly project: string, readonly version: number) {}

    /** 追加扩展字段及其应用逻辑；空值忽略，便于可选扩展直接传入。 */
    extend(extension: ConfigExtension | null | undefined): this { if (extension) this.extensions.push(extension); return this; }
    /** 注册启动插件，按注册顺序执行；空值忽略，便于按开关传入。 */
    use(plugin: ConfigPlugin | null | undefined): this { if (plugin) this.plugins.push(plugin); return this; }
    /** 追加跨字段校验，可多次调用。 */
    validate(validator: ConfigValidator<T>): this { this.validators.push(validator); return this; }
    /** 设置旧版本文档迁移函数。 */
    migrate(migration: ConfigMigration): this { this.migration = migration; return this; }
    /** 设置项目层文档（如 JsonAsset.json）；空值表示没有项目文件。 */
    projectDocument(document: unknown): this { this.projectInput = document === null ? undefined : document; return this; }
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
        const groups: ConfigGroupInfo[] = [], seen: Record<string, ConfigGroupInfo> = Object.create(null);
        for (const source of [this.definition.groups, ...this.extensions.map(extension => extension.groups || [])]) {
            for (const info of source) {
                const known = seen[info.key];
                if (!known) { seen[info.key] = info; groups.push(info); }
                else if (known.label !== info.label) throw new ConfigError(['分组标题冲突：' + info.key + '（' + known.label + ' / ' + info.label + '）']);
            }
        }
        const validators = this.validators.slice(), definition = this.definition;
        const store = new ConfigStore({ project: this.project, version: this.version, schema, groups,
            migrate: this.migration, onListenerError: this.listenerError,
            validate: flat => {
                if (!validators.length) return [];
                const nested = definition.read(flat);
                return validators.reduce<string[]>((issues, validator) => issues.concat(validator(nested, flat)), []);
            } });
        const warnings: string[] = [];
        if (this.projectInput !== undefined) warnings.push(...store.importDocument(this.projectInput, '项目').map(text => '项目配置：' + text));
        const started: ConfigPlugin[] = [], applied: ConfigExtension[] = [], unsubscribers: (() => void)[] = [];
        let release: (() => void) | null = null;
        // 逆序撤销已完成的步骤；启动失败与正常释放共用。
        const cleanup = () => {
            unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
            for (const plugin of started.splice(0).reverse()) plugin.dispose?.();
            for (const extension of applied.splice(0).reverse()) extension.restore();
            release?.(); release = null;
        };
        try {
            for (const plugin of this.plugins) {
                started.push(plugin);
                const issues = plugin.beforeStart?.(store);
                if (issues) warnings.push(...issues);
            }
            store.start();
            release = definition.attach(store);
            for (const extension of this.extensions) { applied.push(extension); extension.apply(store); }
            for (const extension of applied) {
                if (extension.update) unsubscribers.push(store.subscribe(snapshot => { if (snapshot.changed.length) extension.update!(store, snapshot.changed); }));
            }
            for (const listener of this.listeners) unsubscribers.push(store.subscribe(listener));
            for (const plugin of started) plugin.afterStart?.(store);
        } catch (error) { cleanup(); throw error; }
        return new ConfigRuntime(definition, store, Object.freeze(warnings), cleanup);
    }
}
