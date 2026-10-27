import type { FieldBuilder } from './ConfigBuilder';
import type { ConfigExtension, ConfigReader } from './ConfigSetup';
import { ConfigDescription, ConfigError, ConfigField, ConfigSchema, ConfigTiming, ConfigValue, NumberLimits } from './ConfigTypes';

/** 绑定器默认选项；guard 返回假时跳过对该目标的写入，例如目标组件已被销毁。 */
export interface ConfigBinderOptions {
    timing?: ConfigTiming;
    description?: string;
    guard?: (target: object) => boolean;
}

/** 单项绑定选项；name 覆盖键名末段，默认使用属性名。 */
export interface ConfigBindOptions extends NumberLimits {
    name?: string;
    maxLength?: number;
    timing?: ConfigTiming;
    description?: string;
}

/** 支持写入位置的节点最小接口，不依赖引擎类型。 */
export interface PositionTarget {
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    setPosition(x: number, y: number, z: number): void;
}

/** 已登记的一项写入：初始值在登记时取自目标，恢复时写回。 */
interface Binding { key: string; target: object; initial: ConfigValue; write: (value: ConfigValue) => void }

/**
 * 把现有组件或数据对象的属性登记为配置字段：默认值取自对象当前值，
 * 启动后写入生效值，退出时恢复原值；不保存场景或资源。
 */
export class ConfigBinder implements ConfigExtension {
    readonly schema: ConfigSchema = Object.create(null);
    private readonly bindings: Binding[] = [];

    /** 保存默认生效时机、说明与写入守卫。 */
    constructor(readonly options: ConfigBinderOptions = {}) {}

    /** 已登记的字段数量。 */
    get size(): number { return this.bindings.length; }

    /** 创建键前缀与面板分组相同的绑定作用域。 */
    scope(prefix: string, group: string): ConfigBinderScope { return new ConfigBinderScope(this, prefix, group); }

    /** 登记任意字段与写入函数；字段默认值即恢复时写回的原值。 */
    register(key: string, field: ConfigField, target: object, write: (value: ConfigValue) => void): this {
        if (Object.prototype.hasOwnProperty.call(this.schema, key)) throw new ConfigError(['绑定配置键重复：' + key]);
        this.schema[key] = field;
        this.bindings.push({ key, target, initial: field.defaultValue, write });
        return this;
    }

    /** 写入容器中的生效值；只在业务初始化前调用，不读取待重启值。 */
    apply(store: ConfigReader): void {
        for (const binding of this.bindings) this.write(binding, store.get(binding.key));
    }

    /** 恢复登记时记录的原值。 */
    restore(): void { for (const binding of this.bindings) this.write(binding, binding.initial); }

    /** 经守卫检查后写入。 */
    private write(binding: Binding, value: ConfigValue): void {
        if (!this.options.guard || this.options.guard(binding.target)) binding.write(value);
    }
}

/** 绑定作用域：键为“前缀.名称”，所有字段归入同一面板分组；方法均可链式调用。 */
export class ConfigBinderScope {
    /** 由 ConfigBinder.scope 创建。 */
    constructor(private readonly binder: ConfigBinder, readonly prefix: string, readonly group: string) {}

    /** 创建子作用域，分组默认沿用当前分组。 */
    scope(name: string, group: string = this.group): ConfigBinderScope { return new ConfigBinderScope(this.binder, this.prefix + '.' + name, group); }

    /** 绑定数值、开关或文本属性，类型按当前值自动识别。 */
    value<T extends object, K extends keyof T & string>(target: T, property: K, label: string, options: ConfigBindOptions = {}): this {
        const current = target[property] as unknown, key = this.key(options.name || property), info = this.info(label, options);
        let field: ConfigField;
        if (typeof current === 'number') field = { ...info, ...this.limits(options), kind: '数值', defaultValue: current };
        else if (typeof current === 'boolean') field = { ...info, kind: '开关', defaultValue: current };
        else if (typeof current === 'string') field = { ...info, kind: '文本', defaultValue: current, maxLength: options.maxLength ?? 200 };
        else throw new ConfigError(['绑定属性必须是数值、开关或文本：' + key]);
        this.binder.register(key, field, target, value => { target[property] = value as unknown as T[K]; });
        return this;
    }

    /**
     * 绑定向量或颜色等对象属性的若干数字分量。写入时复制当前对象（优先 clone）
     * 后整体赋值，触发引擎属性 setter；不逐分量改写共享对象。
     */
    vector<T extends object, K extends keyof T & string>(target: T, property: K, components: readonly string[], label: string,
        options: ConfigBindOptions = {}): this {
        const key = this.key(options.name || property), current = target[property] as unknown as Record<string, unknown>;
        if (!current || typeof current !== 'object') throw new ConfigError(['绑定向量属性必须是对象：' + key]);
        const initial = components.map(component => current[component]);
        if (initial.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new ConfigError(['绑定向量分量必须是有限数值：' + key]);
        this.binder.register(key, this.vectorField(initial as number[], components, label, options), target, value => {
            const latest = target[property] as unknown as { clone?: () => Record<string, unknown> } & Record<string, unknown>;
            const copy = typeof latest.clone === 'function' ? latest.clone() : { ...latest };
            components.forEach((component, i) => { copy[component] = (value as number[])[i]; });
            target[property] = copy as unknown as T[K];
        });
        return this;
    }

    /** 绑定节点本地位置，通过 setPosition 写入以触发引擎变换更新。 */
    position(node: PositionTarget, label: string, options: ConfigBindOptions = {}): this {
        const key = this.key(options.name || 'position'), p = node.position;
        this.binder.register(key, this.vectorField([p.x, p.y, p.z], ['x', 'y', 'z'], label, options), node,
            value => { const [x, y, z] = value as number[]; node.setPosition(x, y, z); });
        return this;
    }

    /** 用链式构建器登记自定义字段与写入函数，字段归入当前分组；默认值即恢复时写回的原值。 */
    custom(name: string, field: FieldBuilder<ConfigValue>, target: object, write: (value: ConfigValue) => void): this {
        this.binder.register(this.key(name), field.build(name, this.group), target, write);
        return this;
    }

    /** 拼接稳定键。 */
    private key(name: string): string { return this.prefix + '.' + name; }

    /** 生成向量字段声明。 */
    private vectorField(initial: number[], components: readonly string[], label: string, options: ConfigBindOptions): ConfigField {
        return { ...this.info(label, options), ...this.limits(options), kind: '向量', defaultValue: initial, components };
    }

    /** 合成标题、分组、生效时机与说明，单项选项优先于绑定器默认值。 */
    private info(label: string, options: ConfigBindOptions): ConfigDescription {
        const defaults = this.binder.options;
        return { label, group: this.group, timing: options.timing ?? defaults.timing ?? '重启', description: options.description ?? defaults.description };
    }

    /** 只取数值约束字段。 */
    private limits(options: ConfigBindOptions): NumberLimits {
        return { min: options.min, max: options.max, integer: options.integer, step: options.step };
    }
}
