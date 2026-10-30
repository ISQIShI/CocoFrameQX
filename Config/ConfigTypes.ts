/** 配置只保存可序列化数据；节点、资源、函数和运行时状态不应放入配置。 */
export type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue };

/** 任意配置数据的递归只读形式。 */
export type ConfigReadonlyValue = null | boolean | number | string | readonly ConfigReadonlyValue[] | { readonly [key: string]: ConfigReadonlyValue };

/**
 * 对外配置快照递归只读，避免业务绕过校验直接修改共享参数。
 * 完整 ConfigValue 直接映射为显式只读类型，避免对递归联合逐层展开导致类型实例化过深。
 */
export type ConfigReadonly<T> = ConfigValue extends T ? ConfigReadonlyValue
    : T extends object ? { readonly [K in keyof T]: ConfigReadonly<T[K]> } : T;

/** 以扁平键索引的只读配置值。 */
export type ConfigRecord = Readonly<Record<string, ConfigValue>>;

/** 字段显示条件：根据以扁平键索引的当前值判断是否显示。 */
export type ConfigCondition = (values: ConfigRecord) => boolean;

/** 参数的生效时机；涉及初始场地、刚体结构等参数默认在重启后生效。 */
export type ConfigTiming = '实时' | '重启';

/** 参数在测试面板中的中文说明；group 为所属分组的键路径（分组身份），不是显示标题。 */
export interface ConfigDescription {
    label: string;
    group?: string;
    description?: string;
    timing?: ConfigTiming;
    /** 显示单位，如 m/s、秒；只用于面板显示。 */
    unit?: string;
    /**
     * 面板显示条件：参数为以扁平键索引的当前值（面板中含可读的未应用输入），返回 true 时显示。
     * 只影响面板，不影响取值、校验与导出；抛出异常时按显示处理。
     */
    showWhen?: ConfigCondition;
}

/** 分组声明：key 为分组在定义树中的键路径，作为稳定身份与层级依据；label 只用于显示。 */
export interface ConfigGroupInfo {
    key: string;
    label: string;
    description?: string;
}

/** 容器整理后的分组：parent 为键路径前缀中最近的已声明分组，顶级分组为 null。 */
export interface ConfigGroupEntry extends ConfigGroupInfo {
    readonly parent: string | null;
}

/** 数值约束，数值字段与向量字段的每个分量共用。 */
export interface NumberLimits {
    min?: number;
    max?: number;
    integer?: boolean;
    step?: number;
}

/** 数值参数声明；所有数值必须有限，可进一步限定范围与整数。 */
export interface NumberField extends ConfigDescription, NumberLimits { kind: '数值'; defaultValue: number }

/** 开关参数声明。 */
export interface BooleanField extends ConfigDescription { kind: '开关'; defaultValue: boolean }

/** 短文本参数声明；不用于执行脚本。 */
export interface StringField extends ConfigDescription { kind: '文本'; defaultValue: string; maxLength?: number }

/** 从有限字符串选项中选择的参数声明。 */
export interface ChoiceField extends ConfigDescription { kind: '选项'; defaultValue: string; choices: readonly string[] }

/** 表格或复杂数据声明，业务必须显式提供形状校验函数。 */
export interface JsonField extends ConfigDescription {
    kind: '数据';
    defaultValue: ConfigValue;
    accepts: (value: ConfigValue) => boolean;
}

/** 定长数字数组，如位置、尺寸、颜色；每个分量共用同一组数值约束。 */
export interface VectorField extends ConfigDescription, NumberLimits {
    kind: '向量';
    defaultValue: number[];
    /** 分量名称，同时决定数组长度，如 ['x', 'y', 'z'] 或 ['r', 'g', 'b', 'a']。 */
    components: readonly string[];
}

/** 支持的参数声明集合。 */
export type ConfigField = NumberField | BooleanField | StringField | ChoiceField | JsonField | VectorField;

/** 使用稳定键组织配置，点号仅用于分组命名，不执行对象路径写入。 */
export type ConfigSchema = Record<string, ConfigField>;

/** 优先级从项目到本地再到会话递增；声明默认值始终作为兜底。 */
export type ConfigLayer = '项目' | '本地' | '会话';

/**
 * 导出范围：“改动”只含本地/会话层相对“默认 + 项目层”的差异，用于本地保存、复现链接与叠加在项目配置上分享；
 * “非默认”含全部层中不同于声明默认值的目标值，可直接作为新的项目配置文件；“全部”为每个字段的完整目标值。
 */
export type ConfigExportScope = '改动' | '非默认' | '全部';

/** 一次层更新的结果；deferred 表示改动合法但只能整体推迟到重启生效。 */
export interface ConfigUpdateResult {
    readonly changed: boolean;
    readonly deferred: boolean;
}

/** 将旧版本文档的值迁移为当前版本；返回值仍需通过当前声明的校验。 */
export type ConfigMigration = (values: Record<string, ConfigValue>, fromVersion: number) => Record<string, ConfigValue>;

/** 跨项目、跨配置版本交换时使用的 JSON 文件格式。 */
export interface ConfigDocument {
    format: 1;
    project: string;
    version: number;
    values: Record<string, ConfigValue>;
}

/** 校验问题：message 为中文说明，keys 为涉及的参数键（可为空），面板据此把问题显示在对应字段旁。 */
export interface ConfigIssue {
    readonly message: string;
    readonly keys: readonly string[];
}

/** 校验函数的返回项：纯文本（不定位到字段）或带涉及参数键的问题。 */
export type ConfigIssueInput = string | { readonly message: string; readonly keys?: readonly string[] };

/** 声明涉及若干参数键的校验问题，例如 configIssue('最小值不能大于最大值', 'launch.min', 'launch.max')。 */
export function configIssue(message: string, ...keys: string[]): ConfigIssue { return { message, keys }; }

/** 把校验返回项统一为带键列表的问题。 */
export function toConfigIssue(input: ConfigIssueInput): ConfigIssue {
    return typeof input === 'string' ? { message: input, keys: [] } : { message: input.message, keys: input.keys ? input.keys.slice() : [] };
}

/** 配置校验或输入格式错误；一次提交失败不会留下部分参数。 */
export class ConfigError extends Error {
    /** 中文错误文本，供提示和自动化验证使用。 */
    readonly issues: readonly string[];
    /** 带涉及参数键的错误明细，供面板定位字段。 */
    readonly details: readonly ConfigIssue[];
    /** 接受纯文本或带参数键的问题。 */
    constructor(issues: readonly ConfigIssueInput[]) {
        const details = issues.map(toConfigIssue);
        super(details.map(item => item.message).join('\n'));
        this.name = 'ConfigError';
        this.details = details;
        this.issues = details.map(item => item.message);
    }
}
