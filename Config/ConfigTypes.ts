/** 配置只保存可序列化数据；节点、资源、函数和运行时状态不应放入配置。 */
export type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue };

/** 对外配置快照递归只读，避免业务绕过校验直接修改共享参数。 */
export type ConfigReadonly<T> = T extends object ? { readonly [K in keyof T]: ConfigReadonly<T[K]> } : T;

/** 参数的生效时机；涉及初始场地、刚体结构等参数默认在重启后生效。 */
export type ConfigTiming = '实时' | '重启';

/** 参数在测试面板中的中文说明。 */
export interface ConfigDescription {
    label: string;
    group?: string;
    description?: string;
    timing?: ConfigTiming;
}

/** 数值参数声明；所有数值必须有限，可进一步限定范围与整数。 */
export interface NumberField extends ConfigDescription {
    kind: '数值';
    defaultValue: number;
    min?: number;
    max?: number;
    integer?: boolean;
    step?: number;
}

/** 开关参数声明。 */
export interface BooleanField extends ConfigDescription { kind: '开关'; defaultValue: boolean }

/** 短文本参数声明；不用于执行脚本。 */
export interface StringField extends ConfigDescription { kind: '文本'; defaultValue: string; maxLength?: number }

/** 从有限字符串选项中选择的参数声明。 */
export interface ChoiceField<T extends string = string> extends ConfigDescription {
    kind: '选项';
    defaultValue: T;
    choices: readonly T[];
}

/** 表格或复杂数据声明，业务必须显式提供形状校验函数。 */
export interface JsonField<T extends ConfigValue = ConfigValue> extends ConfigDescription {
    kind: '数据';
    defaultValue: T;
    accepts: (value: ConfigValue) => value is T;
}

/** 支持的参数声明集合。 */
export type ConfigField = NumberField | BooleanField | StringField | ChoiceField | JsonField;

/** 使用稳定键组织配置，点号仅用于分组命名，不执行对象路径写入。 */
export type ConfigSchema = Record<string, ConfigField>;

/** 从字段声明推导业务读取类型。 */
export type ConfigValues<S extends ConfigSchema> = { readonly [K in keyof S]: ConfigReadonly<S[K]['defaultValue']> };

/** 创建数值参数；省略生效时机时采用重启生效。 */
export function numberField(defaultValue: number, options: ConfigDescription & { min?: number; max?: number; integer?: boolean; step?: number }): NumberField {
    return { ...options, kind: '数值', defaultValue };
}

/** 创建开关参数。 */
export function booleanField(defaultValue: boolean, options: ConfigDescription): BooleanField {
    return { ...options, kind: '开关', defaultValue };
}

/** 创建文本参数。 */
export function stringField(defaultValue: string, options: ConfigDescription & { maxLength?: number }): StringField {
    return { ...options, kind: '文本', defaultValue };
}

/** 创建枚举选项；选项字符串可以是中文业务值。 */
export function choiceField<T extends string>(defaultValue: T, choices: readonly T[], options: ConfigDescription): ChoiceField<T> {
    return { ...options, kind: '选项', defaultValue, choices };
}

/** 创建复杂 JSON 参数，校验必须覆盖业务依赖的数据结构和范围。 */
export function jsonField<T extends ConfigValue>(defaultValue: T, options: ConfigDescription & { accepts: (value: ConfigValue) => value is T }): JsonField<T> {
    return { ...options, kind: '数据', defaultValue };
}

/** 优先级从项目到本地再到会话递增；声明默认值始终作为兜底。 */
export type ConfigLayer = '项目' | '本地' | '会话';

/** 跨项目、跨配置版本交换时使用的 JSON 文件格式。 */
export interface ConfigDocument {
    format: 1;
    project: string;
    version: number;
    values: Record<string, ConfigValue>;
}

/** 配置校验或输入格式错误；一次提交失败不会留下部分参数。 */
export class ConfigError extends Error {
    /** 保存中文错误明细，供面板和自动化验证使用。 */
    constructor(public readonly issues: readonly string[]) {
        super(issues.join('\n'));
        this.name = 'ConfigError';
    }
}
