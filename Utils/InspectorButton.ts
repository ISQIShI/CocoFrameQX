import { _decorator, CCBoolean, Component } from 'cc';
import { EDITOR } from 'cc/env';

const { property } = _decorator;

/**
 * 按钮参数配置项
 * 
 * 直接支持 Cocos Creator @property 所支持的所有类型与原生配置项。
 * 配置的类型与选项将直接透传至动态生成的 @property 中，无额外封装限制。
 */
export interface IButtonParamOptions {
    /** 
     * 参数标识名（对应方法形参名，用于在组件实例上保存该参数的当前输入值）
     */
    name: string;

    /** 
     * 参数类型，直接映射传入 @property 的 type 选项中。
     * 支持 @property 接受的全部类型：
     * - 基础类型: CCInteger, CCFloat, CCString, CCBoolean
     * - 引擎内置对象: Node, Component, Prefab, Material, SpriteFrame, AudioClip 等
     * - 结构/值类型: Vec2, Vec3, Vec4, Color, Rect, Size 等
     * - 数组类型: [Node], [CCString], [CCInteger] 等
     * - 枚举类型: Enum(MyEnum)
     * - 自定义 CCClass 类型
     */
    type?: any;

    /** 
     * 参数默认值。
     * 支持直接传入数值/对象，或通过工厂函数生成（例如 () => new Vec3()）
     */
    default?: any;

    /** 
     * 在属性检查器中展示的名称，缺省时使用 name
     */
    displayName?: string;

    /** 
     * 鼠标悬停提示
     */
    tooltip?: string;

    /**
     * 该属性是否参与序列化和反序列化。
     */
    serializable?: boolean;

    /** 
     * 允许直接透传 @property 的任意原生配置（如 min, max, step, slide, multiline, serializable 等）
     */
    [key: string]: any;
}

/**
 * 按钮装饰器配置项
 */
export interface IInspectorButtonOptions {
    /** 属性检查器中显示的按钮文本，缺省使用方法名 */
    text?: string;
    /** 悬停提示文字 */
    tooltip?: string;
    /** 
     * 显示排序。默认为 9999，确保按钮与参数排在常规属性之后。
     * 多个按钮可以通过设置不同的 displayOrder 调整先后次序。
     */
    displayOrder?: number;
    /** 
     * 分组配置。若指定，按钮及对应参数输入框将收纳进该折叠分组中。
     * 不指定时，若有参数，默认会自动聚合成以该方法名命名的分组。
     */
    group?: string;
    /** 
     * 有参方法参数列表配置。
     * 将为列表中的每个参数动态生成对应的 @property 输入控件，
     * 点击按钮时自动按序收集输入控件的当前值并传入目标方法。
     */
    params?: IButtonParamOptions[];
}

/**
 * InspectorButton 装饰器
 * 
 * 仅在编辑器模式（EDITOR 宏）下生效。将被装饰的 Component 成员方法在属性检查器中渲染为“可点击执行”的按钮。
 * 
 * @param options 按钮标题字符串，或者完整的配置对象
 * 
 * @example
 * // 1. 无参方法
 * @InspectorButton('重置所有数据')
 * public resetAll() {
 *     console.log('数据已重置');
 * }
 * 
 * @example
 * // 2. 有参方法（支持 Node, Prefab, Vec3, CCInteger 等任意 property 类型）
 * @InspectorButton({
 *     text: '生成敌人',
 *     params: [
 *         { name: 'targetNode', type: Node, displayName: '父节点' },
 *         { name: 'enemyPrefab', type: Prefab, displayName: '敌人预制体' },
 *         { name: 'spawnPos', type: Vec3, default: () => new Vec3(0, 1, 0), displayName: '生成坐标' },
 *         { name: 'count', type: CCInteger, default: 1, min: 1, max: 10, step: 1, displayName: '生成数量' },
 *     ]
 * })
 * public spawnEnemies(parent: Node, prefab: Prefab, pos: Vec3, count: number) {
 *     // ...
 * }
 */
export function InspectorButton(options?: string | IInspectorButtonOptions): MethodDecorator {
    // 仅在编辑器模式下生效，运行时零开销
    if (!EDITOR) {
        return () => { };
    }

    const opts: IInspectorButtonOptions = typeof options === 'string' ? { text: options } : (options || {});

    return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
        const methodName = String(propertyKey);
        const buttonText = opts.text || methodName;
        const baseOrder = opts.displayOrder ?? 9999;

        // 唯一属性键名，避免与其他属性或不同方法间发生冲突
        const triggerPropKey = `_btn_trigger_${methodName}`;
        const hasParams = Array.isArray(opts.params) && opts.params.length > 0;
        const groupName = opts.group || (hasParams ? `Action: ${buttonText}` : undefined);

        // 1. 处理有参方法：将配置的参数类型和选项直接映射传入动态生成的 @property 中
        const paramPropKeys: string[] = [];
        if (hasParams && opts.params) {
            opts.params.forEach((param, index) => {
                const paramPropKey = `_btn_param_${methodName}_${param.name}`;
                paramPropKeys.push(paramPropKey);

                // 解析默认值
                let defaultValue = param.default;
                if (typeof defaultValue === 'function') {
                    try {
                        defaultValue = defaultValue();
                    } catch {
                        // 如果传入的是构造函数而非工厂函数，则保留原值
                    }
                }
                if (defaultValue === undefined) {
                    defaultValue = param.type === CCBoolean ? false : null;
                }

                // 挂载初始默认值到组件原型上
                target[paramPropKey] = defaultValue;

                // 构造原生 property 配置：直接映射用户传入的属性，不作额外包装
                const { name, default: _def, ...customOptions } = param;

                const propOptions: Record<string, any> = {
                    ...customOptions,
                    displayName: param.displayName || param.name,
                    tooltip: param.tooltip || `参数 [${param.name}]`,
                    visible: param.visible !== undefined ? param.visible : true,
                    displayOrder: param.displayOrder !== undefined ? param.displayOrder : baseOrder + index,
                    serializable: param.serializable || false,
                };

                // 直接映射传入配置的 type
                if (param.type !== undefined) {
                    propOptions.type = param.type;
                }

                // 自动归入对应的方法分组
                if (groupName && !propOptions.group) {
                    propOptions.group = { name: groupName, id: groupName };
                }

                // 动态注册参数属性到 CCClass
                property(propOptions)(target, paramPropKey);
            });
        }

        // 2. 构造触发器 Getter / Setter
        let isExecuting = false;

        const triggerDescriptor: PropertyDescriptor = {
            get() {
                // 恒为 false，使复选框交互后始终处于就绪状态
                return false;
            },
            set(this: Component, value: any) {
                // 防重入保护
                if (isExecuting) {
                    return;
                }

                isExecuting = true;
                try {
                    const compName = this.constructor ? this.constructor.name : 'Component';
                    const fn = (this as any)[methodName];

                    if (typeof fn !== 'function') {
                        console.error(`[InspectorButton] 组件 [${compName}] 上未找到方法: ${methodName}`);
                        return;
                    }

                    // 收集参数输入框当前的实际值
                    let args: any[] = [];
                    if (paramPropKeys.length > 0) {
                        args = paramPropKeys.map(key => (this as any)[key]);
                    }

                    console.log(`[InspectorButton] ▶ 执行: [${compName}].${methodName}(`, ...args, `)`);

                    // 调用目标方法，绑定当前组件实例 this 上下文
                    fn.apply(this, args);
                } catch (error) {
                    console.error(`[InspectorButton] 执行方法 [${methodName}] 出错:`, error);
                } finally {
                    isExecuting = false;
                }
            },
            enumerable: false,
            configurable: true,
        };

        // 挂载触发器到组件原型
        Object.defineProperty(target, triggerPropKey, triggerDescriptor);

        // 3. 将触发器注册为 CCClass 属性
        // 注意：无需标记 serializable: false
        property({
            type: CCBoolean,
            displayName: `▶ ${buttonText}`,
            tooltip: opts.tooltip || `点击执行 [${methodName}()]`,
            group: groupName ? { name: groupName, id: groupName } : undefined,
            displayOrder: baseOrder + (hasParams && opts.params ? opts.params.length : 0),
            visible: true,
        })(target, triggerPropKey, triggerDescriptor);
    };
}
