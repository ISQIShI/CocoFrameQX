import { ConfigNodeBuilder, FieldBuilder } from './ConfigBuilder';
import { ConfigError, ConfigGroupInfo, ConfigReadonly, ConfigSchema, ConfigTiming, ConfigValue } from './ConfigTypes';
import { ConfigSetup } from './ConfigSetup';

/**
 * 分组节点（组合模式中的容器）：与字段共用标题、说明与生效时机声明，生效时机向组内继承。
 * 分组身份与层级取自它在定义树中的键路径，标题只用于显示，可重名、可含任意字符。
 */
export class ConfigGroup<C extends ConfigTree = ConfigTree> extends ConfigNodeBuilder {
    /** 保存子项。 */
    constructor(readonly children: C) { super(); }
}

/** 定义树节点：字段构建器、分组或只扩展键路径（不形成面板分组）的普通对象。 */
export type ConfigNode = FieldBuilder<ConfigValue> | ConfigGroup<ConfigTree> | ConfigTree;

/** 嵌套定义树；键名以点号连接成稳定的扁平配置键。 */
export interface ConfigTree { readonly [key: string]: ConfigNode }

/** 从定义树推导嵌套读取类型。 */
export type ConfigTreeValues<T> = { readonly [K in keyof T]: ConfigNodeValue<T[K]> };

/** 从单个节点推导读取类型：字段取其值类型，分组与普通对象递归展开。 */
export type ConfigNodeValue<N> = N extends FieldBuilder<infer V> ? ConfigReadonly<V>
    : N extends ConfigGroup<infer C> ? ConfigTreeValues<C> : ConfigTreeValues<N>;

/** 定义接入容器所需的最小能力，避免依赖容器的泛型参数。 */
export interface ConfigSource {
    snapshot(): { readonly active: unknown };
    hasField(key: string): boolean;
}

/** 定义选项；timingNotes 为未写说明的字段按生效时机补充默认说明。 */
export interface ConfigDefinitionOptions {
    timingNotes?: Partial<Record<ConfigTiming, string>>;
}

/** 声明分组；可链式设置 label、describe、live、restart，省略标题时使用键名。 */
export function group<C extends ConfigTree>(children: C): ConfigGroup<C>;
/** 声明带标题的分组（等同 group(children).label(label)）。 */
export function group<C extends ConfigTree>(label: string, children: C): ConfigGroup<C>;
export function group<C extends ConfigTree>(first: string | C, children?: C): ConfigGroup<C> {
    return typeof first === 'string' ? new ConfigGroup(children as C).label(first) : new ConfigGroup(first);
}

/** 复制并递归冻结默认值，防止读取方修改共享默认数据。 */
function frozenCopy(value: ConfigValue): ConfigValue {
    if (value === null || typeof value !== 'object') return value;
    return Object.freeze(JSON.parse(JSON.stringify(value), (_key, item) => item && typeof item === 'object' ? Object.freeze(item) : item));
}

/** 叶子节点在读取视图中的位置。 */
interface Leaf { path: readonly string[]; key: string }

/**
 * 嵌套配置定义：一次声明生成扁平配置表、默认值和类型化读取视图。
 * 同一定义同一时刻只接入一个容器；未接入时读取声明默认值。
 */
export class ConfigDefinition<T extends ConfigTree> {
    /** 扁平配置表，键为点号路径。 */
    readonly schema: ConfigSchema;
    /** 分组表，按声明顺序；键为分组在定义树中的键路径，字段的 group 引用它。 */
    readonly groups: readonly ConfigGroupInfo[];
    /** 声明默认值的嵌套只读快照。 */
    readonly defaults: ConfigTreeValues<T>;
    /** 当前生效值的嵌套读取视图；每次访问读取已接入容器的最新快照。 */
    readonly values: ConfigTreeValues<T>;
    private readonly leaves: Leaf[] = [];
    private readonly fallback: Record<string, ConfigValue> = Object.create(null);
    private source: ConfigSource | null = null;

    /** 展开定义树并生成默认快照与读取视图；键名冲突或空键在此报错。 */
    constructor(readonly tree: T, private readonly options: ConfigDefinitionOptions = {}) {
        const schema: ConfigSchema = Object.create(null), groups: ConfigGroupInfo[] = [];
        this.flatten(tree, [], undefined, undefined, schema, groups);
        this.schema = Object.freeze(schema);
        this.groups = Object.freeze(groups.map(item => Object.freeze(item)));
        this.defaults = this.read(this.fallback);
        this.values = this.view();
    }

    /** 判断是否已有容器接入。 */
    get attached(): boolean { return this.source !== null; }

    /** 接入容器，返回只释放本次接入的函数；容器必须包含定义中的全部键。 */
    attach(source: ConfigSource): () => void {
        if (this.source) throw new ConfigError(['同一配置定义只能接入一个运行容器']);
        const missing = this.leaves.filter(leaf => !source.hasField(leaf.key)).map(leaf => leaf.key);
        if (missing.length) throw new ConfigError(['配置容器缺少定义中的键：' + missing.slice(0, 5).join('、')]);
        this.source = source;
        return () => { if (this.source === source) this.source = null; };
    }

    /** 将扁平值记录转换为嵌套只读对象，供跨字段校验或快照比较使用。 */
    read(flat: Readonly<Record<string, unknown>>): ConfigTreeValues<T> {
        const root: Record<string, unknown> = {};
        for (const leaf of this.leaves) {
            const parent = this.branch(root, leaf.path);
            parent[leaf.path[leaf.path.length - 1]] = flat[leaf.key];
        }
        return this.freezeTree(root) as ConfigTreeValues<T>;
    }

    /** 开始链式启动配置，项目标识与版本用于缓存隔离和文档校验。 */
    setup(project: string, version: number): ConfigSetup<T> { return new ConfigSetup<T>(this, project, version); }

    /** 递归展开定义树：group 为最近分组的键路径，timing 为继承的生效时机；分组按出现顺序登记。 */
    private flatten(node: ConfigTree, path: readonly string[], group: string | undefined, timing: ConfigTiming | undefined,
        schema: ConfigSchema, groups: ConfigGroupInfo[]): void {
        for (const name of Object.keys(node)) {
            if (!name || name.indexOf('.') !== -1) throw new ConfigError(['定义键不能为空或包含点号：' + path.concat(name).join('.')]);
            const child = node[name], childPath = path.concat(name), key = childPath.join('.');
            if (child instanceof FieldBuilder) {
                const field = child.build(name, group, timing);
                const note = this.options.timingNotes?.[field.timing || '重启'];
                if (field.description === undefined && note !== undefined) field.description = note;
                schema[key] = field;
                this.fallback[key] = frozenCopy(field.defaultValue);
                this.leaves.push({ path: childPath, key });
            } else if (child instanceof ConfigGroup) {
                const info = child.info(), entry: ConfigGroupInfo = { key, label: info.label || name };
                if (info.description !== undefined) entry.description = info.description;
                groups.push(entry);
                this.flatten(child.children, childPath, key, info.timing ?? timing, schema, groups);
            } else if (child && typeof child === 'object') this.flatten(child as ConfigTree, childPath, group, timing, schema, groups);
            else throw new ConfigError(['定义节点必须是字段、分组或普通对象：' + key]);
        }
    }

    /** 按路径取得或创建中间对象。 */
    private branch(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
        let current = root;
        for (let i = 0; i < path.length - 1; i++) {
            if (!current[path[i]]) current[path[i]] = {};
            current = current[path[i]] as Record<string, unknown>;
        }
        return current;
    }

    /** 递归冻结普通中间对象。 */
    private freezeTree(value: Record<string, unknown>): Record<string, unknown> {
        for (const key of Object.keys(value)) {
            const item = value[key];
            if (item && typeof item === 'object' && !Object.isFrozen(item)) this.freezeTree(item as Record<string, unknown>);
        }
        return Object.freeze(value);
    }

    /** 生成读取视图：每个叶子是读取已接入容器生效值的访问器，未接入时返回默认值。 */
    private view(): ConfigTreeValues<T> {
        const root: Record<string, unknown> = {};
        for (const leaf of this.leaves) {
            const parent = this.branch(root, leaf.path), key = leaf.key, fallback = this.fallback[key];
            Object.defineProperty(parent, leaf.path[leaf.path.length - 1], { enumerable: true,
                get: () => this.source ? (this.source.snapshot().active as Record<string, unknown>)[key] : fallback });
        }
        return this.freezeTree(root) as ConfigTreeValues<T>;
    }
}

/** 声明嵌套配置定义。 */
export function defineConfig<T extends ConfigTree>(tree: T, options: ConfigDefinitionOptions = {}): ConfigDefinition<T> {
    return new ConfigDefinition<T>(tree, options);
}
