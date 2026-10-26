import { ConfigDocument, ConfigError, ConfigField, ConfigLayer, ConfigSchema, ConfigValue, ConfigValues } from './ConfigTypes';

const LAYERS: readonly ConfigLayer[] = ['项目', '本地', '会话'];
/** 限制一次配置输入的字符数，避免误导入大型资源文件阻塞测试面板。 */
export const CONFIG_TEXT_LIMIT = 65536;

/** 核心容器选项；跨字段规则同时检查目标配置与正在运行的配置。 */
export interface ConfigStoreOptions<S extends ConfigSchema> {
    project: string;
    version: number;
    schema: S;
    validate?: (values: ConfigValues<S>) => readonly string[];
    onListenerError?: (error: unknown) => void;
}

/** 一次原子更新后的只读状态；目标值可能需要重启后才成为当前值。 */
export interface ConfigSnapshot<S extends ConfigSchema> {
    readonly revision: number;
    readonly started: boolean;
    readonly active: ConfigValues<S>;
    readonly desired: ConfigValues<S>;
    readonly pendingRestart: readonly string[];
    readonly sources: Readonly<Record<string, ConfigLayer | '默认'>>;
}

/** 仅接受普通字典，避免把节点、日期或类实例当成配置对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** 拒绝危险属性名；点号键保留为字面量，不进行原型链或深层路径赋值。 */
function safeKey(key: string): boolean {
    return key.length > 0 && key.split('.').every(part => part !== '__proto__' && part !== 'prototype' && part !== 'constructor');
}

/** 复制并验证有限 JSON 数据，同时限制递归深度和节点数，拒绝循环与非数据对象。 */
function copyValue(input: unknown, depth = 0, budget = { remaining: 20000 }): ConfigValue {
    if (depth > 24 || --budget.remaining < 0) throw new ConfigError(['配置数据层级或数量超过限制']);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(value => copyValue(value, depth + 1, budget));
    if (isRecord(input)) {
        const output: Record<string, ConfigValue> = Object.create(null);
        for (const key of Object.keys(input)) {
            if (!safeKey(key)) throw new ConfigError(['配置包含不允许的属性名：' + key]);
            output[key] = copyValue(input[key], depth + 1, budget);
        }
        return output;
    }
    throw new ConfigError(['配置只能包含有限数值、文本、开关、空值、数组与普通对象']);
}

/** 递归冻结数据快照，禁止监听方或业务调用方修改容器内部数据。 */
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const key of Object.keys(value)) freeze((value as Record<string, unknown>)[key]);
        Object.freeze(value);
    }
    return value;
}

/** 判断两份已验证 JSON 数据是否一致；不受对象属性排列顺序影响。 */
function equal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
    }
    return false;
}

/**
 * 与引擎无关的配置容器。优先级：声明默认值 < 项目文件 < 本地保存 < 本次会话。
 * 所有变更先完整校验再提交；业务状态和引擎对象不由此容器管理。
 */
export class ConfigStore<S extends ConfigSchema> {
    readonly project: string;
    readonly version: number;
    private readonly schema: S;
    private readonly options: ConfigStoreOptions<S>;
    private layers: Record<ConfigLayer, Record<string, ConfigValue>> = { 项目: {}, 本地: {}, 会话: {} };
    private state: ConfigSnapshot<S>;
    private readonly listeners = new Set<(state: ConfigSnapshot<S>) => void>();
    private notifying = false;

    /** 固化声明与默认值；无效的开发配置在创建时直接报错。 */
    constructor(options: ConfigStoreOptions<S>) {
        if (!options.project.trim() || !Number.isInteger(options.version) || options.version < 1)
            throw new ConfigError(['项目标识不能为空，配置版本必须为正整数']);
        this.project = options.project;
        this.version = options.version;
        this.options = { ...options };
        const schema: Record<string, ConfigField> = Object.create(null);
        for (const key of Object.keys(options.schema)) {
            if (!safeKey(key)) throw new ConfigError(['配置键不合法：' + key]);
            const field = options.schema[key];
            if (!field.label.trim() || (field.timing !== undefined && field.timing !== '实时' && field.timing !== '重启'))
                throw new ConfigError(['参数说明或生效时机无效：' + key]);
            if (field.kind === '数值' && [field.min, field.max, field.step].some(value => value !== undefined && !Number.isFinite(value)))
                throw new ConfigError(['数值约束必须为有限数值：' + key]);
            if (field.kind === '数值' && field.step !== undefined && field.step <= 0)
                throw new ConfigError(['面板步长必须大于零：' + key]);
            if (field.kind === '文本' && field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 0))
                throw new ConfigError(['文本长度上限必须为非负整数：' + key]);
            schema[key] = freeze({ ...field, defaultValue: freeze(copyValue(field.defaultValue)),
                ...(field.kind === '选项' ? { choices: [...field.choices] } : {}) } as ConfigField);
        }
        this.schema = Object.freeze(schema) as S;
        const values = this.combine(this.layers);
        this.validateValues(values);
        this.state = freeze({ revision: 0, started: false, active: values, desired: values,
            pendingRestart: [], sources: this.sources(this.layers) });
    }

    /** 列出稳定键与只读声明，用于面板、文档工具及项目自身的调试界面。 */
    fields(): readonly (readonly [string, ConfigField])[] {
        return Object.freeze(Object.keys(this.schema).map(key => Object.freeze([key, this.schema[key]] as const)));
    }

    /** 按稳定键读取本局实际生效值；类型由字段声明推导。 */
    get<K extends keyof S & string>(key: K): ConfigValues<S>[K] {
        if (!Object.prototype.hasOwnProperty.call(this.schema, key)) throw new ConfigError(['未知配置键：' + key]);
        return (this.state.active as Record<string, unknown>)[key] as ConfigValues<S>[K];
    }

    /** 获取当前值、目标值、覆盖来源和待重启字段。 */
    snapshot(): ConfigSnapshot<S> { return this.state; }

    /** 在全部启动配置加载完后调用；此后重启字段只更新目标值，不改动运行中的实体。 */
    start(): void {
        this.assertWritable();
        if (this.state.started) return;
        this.state = freeze({ ...this.state, revision: this.state.revision + 1, started: true });
        this.notify();
    }

    /** 完整替换指定层；空对象撤销该层覆盖，缺省字段继续继承低优先级。 */
    replaceLayer(layer: ConfigLayer, values: unknown): void { this.replaceLayers({ [layer]: values }); }

    /** 合并某层的少量字段；删除覆盖请用完整替换，不用空值模拟删除。 */
    patchLayer(layer: ConfigLayer, values: unknown): void {
        if (!LAYERS.includes(layer)) throw new ConfigError(['未知配置层：' + layer]);
        const patch = this.readPatch(values);
        this.replaceLayer(layer, { ...this.layers[layer], ...patch });
    }

    /** 原子替换多层，适用于同时清除本地与本次测试覆盖。 */
    replaceLayers(updates: Partial<Record<ConfigLayer, unknown>>): void {
        this.assertWritable();
        if (!isRecord(updates)) throw new ConfigError(['配置层更新必须为对象']);
        const next = { ...this.layers };
        for (const key of Object.keys(updates)) {
            if (!LAYERS.includes(key as ConfigLayer)) throw new ConfigError(['未知配置层：' + key]);
            next[key as ConfigLayer] = this.readPatch(updates[key as ConfigLayer]);
        }
        const desired = this.combine(next);
        this.validateValues(desired);
        const currentValues = this.state.active as unknown as Record<string, ConfigValue>;
        const desiredValues = desired as unknown as Record<string, ConfigValue>;
        const active: Record<string, ConfigValue> = Object.create(null);
        for (const key of Object.keys(this.schema)) {
            // 只有明确声明实时的字段才在本局改变，其余参数等到新容器启动时生效。
            active[key] = this.state.started && this.schema[key].timing !== '实时'
                ? currentValues[key] : desiredValues[key];
        }
        const activeValues = freeze(active) as unknown as ConfigValues<S>;
        this.validateValues(activeValues);
        if (equal(next, this.layers)) return;
        this.layers = next;
        this.state = freeze({ revision: this.state.revision + 1, started: this.state.started, active: activeValues, desired,
            pendingRestart: Object.keys(this.schema).filter(key => !equal(active[key], desiredValues[key])),
            sources: this.sources(next) });
        this.notify();
    }

    /** 校验导入文件的项目和版本；拒绝未知版本，迁移由业务显式完成。 */
    parseDocument(input: unknown): ConfigDocument {
        let parsed: unknown = input;
        if (typeof input === 'string') {
            if (input.length > CONFIG_TEXT_LIMIT) throw new ConfigError(['配置文本超过 64K 字符限制']);
            try { parsed = JSON.parse(input); }
            catch { throw new ConfigError(['配置不是有效的 JSON 文本']); }
        }
        if (!isRecord(parsed) || Object.keys(parsed).some(key => !['format', 'project', 'version', 'values'].includes(key)) ||
            parsed.format !== 1 || parsed.project !== this.project || parsed.version !== this.version)
            throw new ConfigError(['配置格式、项目标识或版本不匹配，未导入']);
        return { format: 1, project: this.project, version: this.version, values: this.readPatch(parsed.values) };
    }

    /** 导入到指定层并原子替换该层；导入部分值时仍继承其他层。 */
    importDocument(input: unknown, layer: ConfigLayer = '会话'): void {
        this.replaceLayer(layer, this.parseDocument(input).values);
    }

    /** 导出全部目标值以供复现；待重启值会在下次启动时生效，配置不包含局内状态。 */
    exportDocument(): ConfigDocument {
        return { format: 1, project: this.project, version: this.version,
            values: copyValue(this.state.desired) as Record<string, ConfigValue> };
    }

    /** 导出可读 JSON；不写入本地存储或触发下载。 */
    exportJSON(): string { return JSON.stringify(this.exportDocument(), null, 2); }

    /** 订阅成功提交；返回解绑函数，异常监听不阻断其他监听或回滚已提交配置。 */
    subscribe(listener: (state: ConfigSnapshot<S>) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** 拒绝通知过程中的同步重入，保证每个观察者看到同一版本。 */
    private assertWritable(): void {
        if (this.notifying) throw new ConfigError(['不能在配置通知中同步改写配置，请在业务下一次更新时提交']);
    }

    /** 逐字段读取覆盖值，不接受拼写错误或隐式类型转换。 */
    private readPatch(input: unknown): Record<string, ConfigValue> {
        if (!isRecord(input)) throw new ConfigError(['配置值必须为普通对象']);
        const copied = copyValue(input) as Record<string, ConfigValue>;
        for (const key of Object.keys(copied)) {
            if (!Object.prototype.hasOwnProperty.call(this.schema, key)) throw new ConfigError(['未知配置键：' + key]);
            this.validateField(key, copied[key]);
        }
        return freeze(copied);
    }

    /** 按层优先级合成完整、只读的目标值；数组和对象字段整体替换，不按下标混合。 */
    private combine(layers: Record<ConfigLayer, Record<string, ConfigValue>>): ConfigValues<S> {
        const values: Record<string, ConfigValue> = Object.create(null);
        for (const key of Object.keys(this.schema)) values[key] = this.schema[key].defaultValue;
        for (const layer of LAYERS) Object.assign(values, layers[layer]);
        return freeze(values) as unknown as ConfigValues<S>;
    }

    /** 计算每个目标值的来源，用于定位保存数据或链接覆盖引起的参数变化。 */
    private sources(layers: Record<ConfigLayer, Record<string, ConfigValue>>): Record<string, ConfigLayer | '默认'> {
        const result: Record<string, ConfigLayer | '默认'> = Object.create(null);
        for (const key of Object.keys(this.schema)) {
            result[key] = '默认';
            for (const layer of LAYERS) if (Object.prototype.hasOwnProperty.call(layers[layer], key)) result[key] = layer;
        }
        return result;
    }

    /** 校验单个字段，错误信息包含稳定键和中文标题。 */
    private validateField(key: string, value: ConfigValue): void {
        const field = this.schema[key];
        let valid = false;
        switch (field.kind) {
            case '数值': valid = typeof value === 'number' && Number.isFinite(value) &&
                (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max) &&
                (!field.integer || Number.isInteger(value)); break;
            case '开关': valid = typeof value === 'boolean'; break;
            case '文本': valid = typeof value === 'string' && value.length <= (field.maxLength ?? 1024); break;
            case '选项': valid = typeof value === 'string' && field.choices.includes(value); break;
            case '数据':
                try { valid = field.accepts(freeze(value)); }
                catch { valid = false; }
                break;
        }
        if (!valid) throw new ConfigError([field.label + '（' + key + '）类型、范围或数据结构不合法']);
    }

    /** 完整配置的跨字段约束也必须通过；例如最小速度不能超过最大速度。 */
    private validateValues(values: ConfigValues<S>): void {
        const data = values as unknown as Record<string, ConfigValue>;
        for (const key of Object.keys(this.schema)) this.validateField(key, data[key]);
        if (this.options.validate) {
            const errors = this.options.validate(values);
            if (errors.length) throw new ConfigError(errors);
        }
    }

    /** 对快照监听者逐个通知，保证解绑和异常不会破坏正在提交的事务。 */
    private notify(): void {
        this.notifying = true;
        try {
            for (const listener of Array.from(this.listeners)) {
                try { listener(this.state); }
                catch (error) {
                    try {
                        if (this.options.onListenerError) this.options.onListenerError(error);
                        else console.error('配置监听执行失败', error);
                    } catch { console.error('配置错误处理函数执行失败'); }
                }
            }
        } finally { this.notifying = false; }
    }
}
