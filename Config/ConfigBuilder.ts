import { ConfigDescription, ConfigField, ConfigTiming, ConfigValue, NumberLimits } from './ConfigTypes';

/**
 * 链式字段构建器基类：在声明阶段收集标题、说明与生效时机，由配置定义统一生成字段。
 * 链式调用只发生在声明期，运行时读取不经过构建器。
 */
export abstract class FieldBuilder<V extends ConfigValue> {
    /** 仅供类型推导的取值类型标记，运行时不存在。 */
    declare readonly valueType: V;
    private text = '';
    private note: string | undefined;
    private timingValue: ConfigTiming | undefined;

    /** 设置面板标题；省略时使用字段键名。 */
    label(text: string): this { this.text = text; return this; }
    /** 设置面板补充说明。 */
    describe(text: string): this { this.note = text; return this; }
    /** 应用后立即生效；业务须在使用点读取或订阅变化。 */
    live(): this { this.timingValue = '实时'; return this; }
    /** 保存后重新启动生效（默认）。 */
    restart(): this { this.timingValue = '重启'; return this; }

    /** 生成字段声明；group 来自所在分组路径，省略标题时使用键名。 */
    build(key: string, group?: string): ConfigField {
        const info: ConfigDescription = { label: this.text || key };
        if (group) info.group = group;
        if (this.note !== undefined) info.description = this.note;
        if (this.timingValue !== undefined) info.timing = this.timingValue;
        return this.create(info);
    }
    /** 由具体类型生成字段。 */
    protected abstract create(info: ConfigDescription): ConfigField;
}

/** 带数值约束的构建器，数值与向量字段共用。 */
abstract class LimitedBuilder<V extends ConfigValue> extends FieldBuilder<V> {
    protected limits: NumberLimits = {};
    /** 同时设置上下限。 */
    range(min: number, max: number): this { this.limits.min = min; this.limits.max = max; return this; }
    /** 设置下限。 */
    min(value: number): this { this.limits.min = value; return this; }
    /** 设置上限。 */
    max(value: number): this { this.limits.max = value; return this; }
    /** 只接受整数。 */
    int(): this { this.limits.integer = true; return this; }
    /** 设置面板步长。 */
    step(value: number): this { this.limits.step = value; return this; }
}

/** 数值字段构建器。 */
export class NumberBuilder extends LimitedBuilder<number> {
    /** 保存默认值。 */
    constructor(private readonly initial: number) { super(); }
    /** 生成数值字段。 */
    protected create(info: ConfigDescription): ConfigField { return { ...info, ...this.limits, kind: '数值', defaultValue: this.initial }; }
}

/** 开关字段构建器。 */
export class BooleanBuilder extends FieldBuilder<boolean> {
    /** 保存默认值。 */
    constructor(private readonly initial: boolean) { super(); }
    /** 生成开关字段。 */
    protected create(info: ConfigDescription): ConfigField { return { ...info, kind: '开关', defaultValue: this.initial }; }
}

/** 短文本字段构建器。 */
export class TextBuilder extends FieldBuilder<string> {
    private limit: number | undefined;
    /** 保存默认值。 */
    constructor(private readonly initial: string) { super(); }
    /** 设置最大字符数。 */
    maxLength(value: number): this { this.limit = value; return this; }
    /** 生成文本字段。 */
    protected create(info: ConfigDescription): ConfigField { return { ...info, kind: '文本', defaultValue: this.initial, maxLength: this.limit }; }
}

/** 枚举选项字段构建器。 */
export class ChoiceBuilder<T extends string> extends FieldBuilder<T> {
    /** 保存默认值与可选项。 */
    constructor(private readonly initial: T, private readonly choices: readonly T[]) { super(); }
    /** 生成选项字段。 */
    protected create(info: ConfigDescription): ConfigField { return { ...info, kind: '选项', defaultValue: this.initial, choices: this.choices }; }
}

/** 复杂数据字段构建器，校验函数必须覆盖业务依赖的结构与范围。 */
export class JsonBuilder<T extends ConfigValue> extends FieldBuilder<T> {
    /** 保存默认值与类型守卫。 */
    constructor(private readonly initial: T, private readonly accepts: (value: ConfigValue) => value is T) { super(); }
    /** 生成数据字段。 */
    protected create(info: ConfigDescription): ConfigField { return { ...info, kind: '数据', defaultValue: this.initial, accepts: this.accepts }; }
}

/** 定长数字向量字段构建器，如位置、尺寸、颜色。 */
export class VectorBuilder extends LimitedBuilder<number[]> {
    /** 保存默认值与分量名称。 */
    constructor(private readonly initial: number[], private readonly components: readonly string[]) { super(); }
    /** 生成向量字段。 */
    protected create(info: ConfigDescription): ConfigField {
        return { ...info, ...this.limits, kind: '向量', defaultValue: this.initial, components: this.components };
    }
}

/** 声明数值参数。 */
export function num(defaultValue: number): NumberBuilder { return new NumberBuilder(defaultValue); }
/** 声明开关参数。 */
export function bool(defaultValue: boolean): BooleanBuilder { return new BooleanBuilder(defaultValue); }
/** 声明短文本参数。 */
export function text(defaultValue: string): TextBuilder { return new TextBuilder(defaultValue); }
/** 声明枚举选项；选项数组建议使用 as const 保留字面量类型。 */
export function choice<T extends string>(defaultValue: T, choices: readonly T[]): ChoiceBuilder<T> { return new ChoiceBuilder(defaultValue, choices); }
/** 声明复杂数据参数，accepts 必须是类型守卫。 */
export function json<T extends ConfigValue>(defaultValue: T, accepts: (value: ConfigValue) => value is T): JsonBuilder<T> {
    return new JsonBuilder(defaultValue, accepts);
}
/** 声明定长数字向量，默认分量为 x、y、z。 */
export function vec(defaultValue: number[], components: readonly string[] = ['x', 'y', 'z']): VectorBuilder {
    return new VectorBuilder(defaultValue, components);
}
/** 声明 0—255 整数 RGBA 颜色。 */
export function color(defaultValue: number[]): VectorBuilder {
    return new VectorBuilder(defaultValue, ['r', 'g', 'b', 'a']).range(0, 255).int();
}
