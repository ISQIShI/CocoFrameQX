import { ConfigDocument, ConfigError, ConfigExportScope, ConfigField, ConfigGroupEntry, ConfigGroupInfo, ConfigIssue, ConfigIssueInput, ConfigLayer, ConfigMigration, ConfigRecord, ConfigSchema, ConfigUpdateResult,
    ConfigValue } from './ConfigTypes';

const LAYERS: readonly ConfigLayer[] = ['项目', '本地', '会话'];
/** 限制一次配置输入的字符数，避免误导入大型资源文件阻塞测试面板。 */
export const CONFIG_TEXT_LIMIT = 65536;

/** 容器选项；跨字段规则同时检查目标配置与正在运行的配置。 */
export interface ConfigStoreOptions {
    project: string;
    version: number;
    schema: ConfigSchema;
    /** 分组声明，按显示顺序；字段引用了未声明的分组时自动补一个以键为标题的分组。 */
    groups?: readonly ConfigGroupInfo[];
    validate?: (values: ConfigRecord) => readonly ConfigIssueInput[];
    /** 导入低于当前版本的文档时调用；未提供时按当前声明直接导入。 */
    migrate?: ConfigMigration;
    onListenerError?: (error: unknown) => void;
}

/** 一次原子更新后的只读状态；目标值可能需要重启后才成为当前值。 */
export interface ConfigSnapshot {
    readonly revision: number;
    readonly started: boolean;
    readonly active: ConfigRecord;
    readonly desired: ConfigRecord;
    readonly pendingRestart: readonly string[];
    readonly sources: Readonly<Record<string, ConfigLayer | '默认'>>;
    /** 本次更新中生效值发生变化的键，供订阅方只处理相关参数。 */
    readonly changed: readonly string[];
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

/** 判断对象自身是否含有键，不读取原型链。 */
function has(record: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(record, key); }

/** 复制并验证有限 JSON 数据，同时限制递归深度和节点数，拒绝循环与非数据对象。 */
function copyValue(input: unknown, depth = 0, budget = { remaining: 20000 }): ConfigValue {
    if (depth > 24 || --budget.remaining < 0) throw new ConfigError(['配置数据层级或数量超过限制']);
    if (input === null) return null;
    if (typeof input === 'string' || typeof input === 'boolean') return input;
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
export function configEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => configEqual(value, b[i]));
    if (isRecord(a) && isRecord(b)) {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every(key => has(b, key) && configEqual(a[key], b[key]));
    }
    return false;
}

/** 检查有限数值是否满足范围和整数约束。 */
function numberAccepted(value: unknown, limits: { min?: number; max?: number; integer?: boolean }): boolean {
    return numberProblem(value, limits) === null;
}

/** 说明数值不满足约束的原因；合法时返回 null。 */
function numberProblem(value: unknown, limits: { min?: number; max?: number; integer?: boolean }): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有限数值';
    if ((limits.min !== undefined && value < limits.min) || (limits.max !== undefined && value > limits.max))
        return '需在 ' + (limits.min ?? '−∞') + ' 至 ' + (limits.max ?? '∞') + ' 之间';
    return limits.integer && !Number.isInteger(value) ? '必须是整数' : null;
}

/** 按字段类型分表校验取值；新增字段类型时在此表与面板控件表各加一项。 */
const KIND_CHECKS: { [K in ConfigField['kind']]: (field: Extract<ConfigField, { kind: K }>, value: ConfigValue) => boolean } = {
    数值: (field, value) => numberAccepted(value, field),
    开关: (_field, value) => typeof value === 'boolean',
    文本: (field, value) => typeof value === 'string' && value.length <= (field.maxLength ?? 1024),
    选项: (field, value) => typeof value === 'string' && field.choices.indexOf(value) !== -1,
    数据: (field, value) => {
        try { return field.accepts(freeze(value)); }
        catch { return false; }
    },
    向量: (field, value) => Array.isArray(value) && value.length === field.components.length && value.every(item => numberAccepted(item, field)),
};

/** 检查字段取值，返回中文问题；合法时返回空值。数值与向量说明具体原因。 */
function fieldIssue(key: string, field: ConfigField, value: ConfigValue): string | null {
    const check = KIND_CHECKS[field.kind] as (field: ConfigField, value: ConfigValue) => boolean;
    if (check(field, value)) return null;
    let reason = '类型、范围或数据结构不合法';
    if (field.kind === '数值') reason = numberProblem(value, field) || reason;
    else if (field.kind === '向量' && Array.isArray(value) && value.length === field.components.length) {
        const index = value.findIndex(item => numberProblem(item, field) !== null);
        if (index !== -1) reason = field.components[index] + ' ' + numberProblem(value[index], field);
    }
    return field.label + '（' + key + '）' + reason;
}

/** 检查声明本身的一致性，开发期错误在创建容器时直接报告。 */
function declarationIssue(key: string, field: ConfigField): string | null {
    if (!safeKey(key)) return '配置键不合法：' + key;
    if (!field.label || !field.label.trim() || (field.timing !== undefined && field.timing !== '实时' && field.timing !== '重启'))
        return '参数说明或生效时机无效：' + key;
    if (field.group !== undefined && (typeof field.group !== 'string' || !field.group)) return '参数分组必须为非空键路径：' + key;
    if (field.unit !== undefined && (typeof field.unit !== 'string' || !field.unit.trim())) return '参数单位必须为非空文本：' + key;
    if (field.showWhen !== undefined && (!Array.isArray(field.showWhen) ||
        field.showWhen.some(condition => !condition || typeof condition.key !== 'string' || !Array.isArray(condition.values) || !condition.values.length)))
        return '参数显示条件必须列出参数键与取值：' + key;
    if ((field.kind === '数值' || field.kind === '向量') &&
        [field.min, field.max, field.step].some(value => value !== undefined && !Number.isFinite(value))) return '数值约束必须为有限数值：' + key;
    if ((field.kind === '数值' || field.kind === '向量') && field.step !== undefined && field.step <= 0) return '面板步长必须大于零：' + key;
    if (field.kind === '文本' && field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 0))
        return '文本长度上限必须为非负整数：' + key;
    if (field.kind === '向量' && (!field.components.length || field.components.some(name => !name) ||
        field.components.some((name, i) => field.components.indexOf(name) !== i))) return '向量分量名称必须非空且互不重复：' + key;
    return null;
}

/**
 * 整理分组：校验声明，补齐字段引用的未声明分组，按键路径前缀确定父分组。
 * 分组只是显示与导航用的元数据，不参与取值、分层和导出。
 */
function resolveGroups(declared: readonly ConfigGroupInfo[], schema: ConfigSchema): readonly ConfigGroupEntry[] {
    const groups: Record<string, ConfigGroupInfo> = Object.create(null), order: string[] = [];
    const add = (info: ConfigGroupInfo) => {
        if (!safeKey(info.key)) throw new ConfigError(['分组键不合法：' + info.key]);
        if (has(groups, info.key)) throw new ConfigError(['分组重复声明：' + info.key]);
        if (has(schema, info.key)) throw new ConfigError(['分组键与参数键重复：' + info.key]);
        if (typeof info.label !== 'string' || !info.label.trim()) throw new ConfigError(['分组标题不能为空：' + info.key]);
        if (info.description !== undefined && typeof info.description !== 'string') throw new ConfigError(['分组说明必须为文本：' + info.key]);
        groups[info.key] = info; order.push(info.key);
    };
    for (const info of declared) add({ key: info.key, label: info.label, ...(info.description !== undefined ? { description: info.description } : {}) });
    for (const key of Object.keys(schema)) {
        const group = schema[key].group;
        if (group !== undefined && !has(groups, group)) add({ key: group, label: group });
    }
    return Object.freeze(order.map(key => {
        let parent: string | null = null;
        for (let i = key.lastIndexOf('.'); i > 0 && parent === null; i = key.lastIndexOf('.', i - 1)) if (has(groups, key.slice(0, i))) parent = key.slice(0, i);
        return Object.freeze({ ...groups[key], parent });
    }));
}

/**
 * 与引擎无关的配置容器。优先级：声明默认值 < 项目文件 < 本地保存 < 本次会话。
 * 所有变更先完整校验再提交；业务状态和引擎对象不由此容器管理。通常由 ConfigSetup 创建。
 */
export class ConfigStore {
    readonly project: string;
    readonly version: number;
    private readonly schema: ConfigSchema;
    private readonly groupList: readonly ConfigGroupEntry[];
    private readonly options: ConfigStoreOptions;
    private layers: Record<ConfigLayer, Record<string, ConfigValue>> = { 项目: {}, 本地: {}, 会话: {} };
    private state: ConfigSnapshot;
    private readonly listeners = new Set<(state: ConfigSnapshot) => void>();
    private notifying = false;

    /** 固化声明与默认值；无效的开发配置在创建时直接报错。 */
    constructor(options: ConfigStoreOptions) {
        if (!options.project.trim() || !Number.isInteger(options.version) || options.version < 1)
            throw new ConfigError(['项目标识不能为空，配置版本必须为正整数']);
        this.project = options.project;
        this.version = options.version;
        this.options = { ...options };
        const schema: ConfigSchema = Object.create(null);
        for (const key of Object.keys(options.schema)) {
            const field = options.schema[key];
            const issue = declarationIssue(key, field);
            if (issue) throw new ConfigError([issue]);
            schema[key] = freeze({ ...field, defaultValue: freeze(copyValue(field.defaultValue)),
                ...(field.kind === '选项' ? { choices: [...field.choices] } : {}),
                ...(field.kind === '向量' ? { components: [...field.components] } : {}) } as ConfigField);
        }
        this.schema = Object.freeze(schema);
        for (const key of Object.keys(schema)) {
            for (const condition of schema[key].showWhen || []) {
                const target = schema[condition.key];
                if (!target || condition.key === key) throw new ConfigError(['显示条件引用了未声明或自身的参数：' + key + ' → ' + condition.key]);
                if (condition.values.some(value => fieldIssue(condition.key, target, value) !== null))
                    throw new ConfigError(['显示条件的取值不符合参数声明：' + key + ' → ' + condition.key]);
            }
        }
        this.groupList = resolveGroups(options.groups || [], schema);
        const values = this.combine(this.layers);
        this.validateValues(values);
        this.state = freeze({ revision: 0, started: false, active: values, desired: values,
            pendingRestart: [], sources: this.sources(this.layers), changed: [] });
    }

    /** 列出稳定键与只读声明，用于面板、文档工具及项目自身的调试界面。 */
    fields(): readonly (readonly [string, ConfigField])[] {
        return Object.freeze(Object.keys(this.schema).map(key => Object.freeze([key, this.schema[key]] as const)));
    }

    /** 列出分组（按显示顺序，含父分组键），用于面板目录与文档工具；未分组的字段 group 为空。 */
    groups(): readonly ConfigGroupEntry[] { return this.groupList; }

    /**
     * 试算：假设把 values 合并进 layer 后的目标值，返回全部校验问题（不修改容器、不通知）。
     * 面板据此在输入时把单字段与跨字段问题显示在相关字段旁；合法时返回空数组。
     */
    check(layer: ConfigLayer, values: unknown): readonly ConfigIssue[] {
        try {
            if (LAYERS.indexOf(layer) === -1) throw new ConfigError(['未知配置层：' + layer]);
            const patch = this.readPatch(values, layer);
            this.validateValues(this.combine({ ...this.layers, [layer]: { ...this.layers[layer], ...patch } }));
            return [];
        } catch (error) {
            if (error instanceof ConfigError) return error.details;
            throw error;
        }
    }

    /** 判断是否声明了指定键。 */
    hasField(key: string): boolean { return has(this.schema, key); }

    /** 按稳定键读取本局实际生效值；业务通常改用配置定义的类型化读取视图。 */
    get(key: string): ConfigValue {
        if (!has(this.schema, key)) throw new ConfigError(['未知配置键：' + key]);
        return this.state.active[key];
    }

    /** 获取当前值、目标值、覆盖来源和待重启字段。 */
    snapshot(): ConfigSnapshot { return this.state; }

    /** 在全部启动配置加载完后调用；此后重启字段只更新目标值，不改动运行中的实体。 */
    start(): void {
        this.assertWritable();
        if (this.state.started) return;
        this.state = freeze({ ...this.state, revision: this.state.revision + 1, started: true, changed: [] });
        this.notify();
    }

    /** 完整替换指定层；空对象撤销该层覆盖，缺省字段继续继承低优先级。 */
    replaceLayer(layer: ConfigLayer, values: unknown): ConfigUpdateResult { return this.replaceLayers({ [layer]: values }); }

    /** 合并某层的少量字段；删除覆盖请用完整替换，不用空值模拟删除。 */
    patchLayer(layer: ConfigLayer, values: unknown): ConfigUpdateResult {
        if (LAYERS.indexOf(layer) === -1) throw new ConfigError(['未知配置层：' + layer]);
        const patch = this.readPatch(values, layer);
        return this.replaceLayer(layer, { ...this.layers[layer], ...patch });
    }

    /**
     * 原子替换多层，适用于同时清除本地与本次测试覆盖。
     * 目标值必须合法；启动后若“实时新值 + 本局重启旧值”的组合非法，本次改动整体推迟到重启，
     * 当前值保持不变并全部列入待重启，结果标记 deferred。
     */
    replaceLayers(updates: Partial<Record<ConfigLayer, unknown>>): ConfigUpdateResult {
        this.assertWritable();
        if (!isRecord(updates)) throw new ConfigError(['配置层更新必须为对象']);
        const next = { ...this.layers };
        for (const key of Object.keys(updates)) {
            if (LAYERS.indexOf(key as ConfigLayer) === -1) throw new ConfigError(['未知配置层：' + key]);
            next[key as ConfigLayer] = this.readPatch(updates[key as ConfigLayer], key as ConfigLayer);
        }
        const desired = this.combine(next);
        this.validateValues(desired);
        if (configEqual(next, this.layers)) return { changed: false, deferred: false };
        const current = this.state.active;
        let active = desired;
        let deferred = false;
        if (this.state.started) {
            const mixed: Record<string, ConfigValue> = Object.create(null);
            // 只有明确声明实时的字段才在本局改变，其余参数等到新容器启动时生效。
            for (const key of Object.keys(this.schema)) mixed[key] = this.schema[key].timing === '实时' ? desired[key] : current[key];
            active = freeze(mixed);
            try { this.validateValues(active); }
            catch (error) {
                if (!(error instanceof ConfigError)) throw error;
                active = current; deferred = true;
            }
        }
        this.layers = next;
        this.state = freeze({ revision: this.state.revision + 1, started: this.state.started, active, desired,
            pendingRestart: Object.keys(this.schema).filter(key => !configEqual(active[key], desired[key])),
            sources: this.sources(next),
            changed: Object.keys(this.schema).filter(key => !configEqual(active[key], current[key])) });
        this.notify();
        return { changed: true, deferred };
    }

    /**
     * 导入配置文档到指定层并原子替换该层，返回跳过的内容说明。未知键和单字段非法值逐项跳过；
     * 低版本文档先经 migrate 迁移；高于当前版本、项目不符、格式错误或跨字段规则失败时整份拒绝。
     */
    importDocument(input: unknown, layer: ConfigLayer = '会话'): readonly string[] {
        let parsed: unknown = input;
        if (typeof input === 'string') {
            if (input.length > CONFIG_TEXT_LIMIT) throw new ConfigError(['配置文本超过 64K 字符限制']);
            try { parsed = JSON.parse(input); }
            catch { throw new ConfigError(['配置不是有效的 JSON 文本']); }
        }
        if (!isRecord(parsed) || Object.keys(parsed).some(key => ['format', 'project', 'version', 'values'].indexOf(key) === -1) ||
            parsed.format !== 1 || parsed.project !== this.project || typeof parsed.version !== 'number' ||
            !Number.isInteger(parsed.version) || parsed.version < 1)
            throw new ConfigError(['配置格式或项目标识不匹配，未导入']);
        const version = parsed.version;
        if (version > this.version) throw new ConfigError(['配置版本 ' + version + ' 高于当前版本 ' + this.version + '，未导入']);
        if (!isRecord(parsed.values)) throw new ConfigError(['配置值必须为普通对象']);
        const issues: string[] = [];
        let values = copyValue(parsed.values) as Record<string, ConfigValue>;
        if (version < this.version) {
            if (this.options.migrate) {
                try { values = copyValue(this.options.migrate(values, version)) as Record<string, ConfigValue>; }
                catch (error) { throw new ConfigError(['配置从版本 ' + version + ' 迁移失败：' + (error instanceof Error ? error.message : String(error))]); }
                if (!isRecord(values)) throw new ConfigError(['配置迁移结果必须为普通对象']);
            } else issues.push('配置版本 ' + version + ' 早于当前版本 ' + this.version + '，已按当前声明导入');
        }
        const accepted: Record<string, ConfigValue> = Object.create(null);
        for (const key of Object.keys(values)) {
            const issue = !has(this.schema, key) ? '未知配置键：' + key : layer !== '项目' && this.schema[key].locked
                ? this.schema[key].label + '（' + key + '）已锁定，只能在项目配置中修改' : fieldIssue(key, this.schema[key], values[key]);
            if (issue) issues.push(issue + '，已跳过');
            else accepted[key] = values[key];
        }
        this.replaceLayer(layer, accepted);
        return issues;
    }

    /**
     * 导出目标值。“改动”只含本地/会话层中相对“默认 + 项目层”基准真正不同的值，叠加在项目配置上使用，
     * 项目配置与代码默认值后续调整仍能生效；“非默认”含项目层在内所有不同于声明默认值的目标值，
     * 用于生成或合并项目配置文件；“全部”为完整目标值。
     */
    exportDocument(scope: ConfigExportScope = '全部'): ConfigDocument {
        const desired = this.state.desired;
        let values: ConfigRecord = desired;
        if (scope === '改动') {
            const baseline = this.combine({ 项目: this.layers.项目, 本地: {}, 会话: {} });
            const changes: Record<string, ConfigValue> = Object.create(null);
            for (const key of Object.keys(this.schema)) {
                if ((has(this.layers.本地, key) || has(this.layers.会话, key)) && !configEqual(desired[key], baseline[key]))
                    changes[key] = desired[key];
            }
            values = changes;
        } else if (scope === '非默认') {
            const changes: Record<string, ConfigValue> = Object.create(null);
            for (const key of Object.keys(this.schema)) if (!configEqual(desired[key], this.schema[key].defaultValue)) changes[key] = desired[key];
            values = changes;
        }
        return { format: 1, project: this.project, version: this.version, values: copyValue(values) as Record<string, ConfigValue> };
    }

    /** 导出可读 JSON；不写入本地存储或触发下载。 */
    exportJSON(scope: ConfigExportScope = '全部'): string { return JSON.stringify(this.exportDocument(scope), null, 2); }

    /** 订阅成功提交；返回解绑函数，异常监听不阻断其他监听或回滚已提交配置。 */
    subscribe(listener: (state: ConfigSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** 拒绝通知过程中的同步重入，保证每个观察者看到同一版本。 */
    private assertWritable(): void {
        if (this.notifying) throw new ConfigError(['不能在配置通知中同步改写配置，请在业务下一次更新时提交']);
    }

    /** 逐字段读取覆盖值，不接受拼写错误、隐式类型转换或在本地与会话层覆盖锁定参数；一次列出全部单字段问题。 */
    private readPatch(input: unknown, layer: ConfigLayer): Record<string, ConfigValue> {
        if (!isRecord(input)) throw new ConfigError(['配置值必须为普通对象']);
        const copied = copyValue(input) as Record<string, ConfigValue>, issues: ConfigIssue[] = [];
        for (const key of Object.keys(copied)) {
            if (!has(this.schema, key)) throw new ConfigError(['未知配置键：' + key]);
            const field = this.schema[key];
            const issue = layer !== '项目' && field.locked ? field.label + '（' + key + '）已锁定，只能在项目配置中修改' : fieldIssue(key, field, copied[key]);
            if (issue) issues.push({ message: issue, keys: [key] });
        }
        if (issues.length) throw new ConfigError(issues);
        return freeze(copied);
    }

    /** 按层优先级合成完整、只读的目标值；数组和对象字段整体替换，不按下标混合。 */
    private combine(layers: Record<ConfigLayer, Record<string, ConfigValue>>): ConfigRecord {
        const values: Record<string, ConfigValue> = Object.create(null);
        for (const key of Object.keys(this.schema)) values[key] = this.schema[key].defaultValue;
        for (const layer of LAYERS) Object.assign(values, layers[layer]);
        return freeze(values);
    }

    /** 计算每个目标值的来源，用于定位保存数据或链接覆盖引起的参数变化。 */
    private sources(layers: Record<ConfigLayer, Record<string, ConfigValue>>): Record<string, ConfigLayer | '默认'> {
        const result: Record<string, ConfigLayer | '默认'> = Object.create(null);
        for (const key of Object.keys(this.schema)) {
            result[key] = '默认';
            for (const layer of LAYERS) if (has(layers[layer], key)) result[key] = layer;
        }
        return result;
    }

    /** 完整配置的跨字段约束也必须通过；例如最小速度不能超过最大速度。 */
    private validateValues(values: ConfigRecord): void {
        const issues: ConfigIssue[] = [];
        for (const key of Object.keys(this.schema)) {
            const issue = fieldIssue(key, this.schema[key], values[key]);
            if (issue) issues.push({ message: issue, keys: [key] });
        }
        if (issues.length) throw new ConfigError(issues);
        const errors = this.options.validate ? this.options.validate(values) : [];
        if (errors.length) throw new ConfigError(errors);
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
