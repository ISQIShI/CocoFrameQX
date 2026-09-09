/**
 * CocoFrameQX - EventTypes
 * 事件中心契约定义、类型映射与元数据结构
 * 
 * 保持纯 TypeScript 实现，无任何第三方或游戏引擎耦合。
 */

/**
 * 事件标识类型：支持字符串、数字（枚举底数值）与 Symbol
 */
export type EventKey = string | number | symbol;

/**
 * 作用域/枚举类型标识：
 * 可以是枚举对象（如 `GameEvent`、`UIEvent`）、命名空间字符串、构造类或 Symbol。
 * 用于在 TypeScript/JavaScript 中隔离不同枚举同名/同值的情况（如 GameEvent.Start=0 与 UIEvent.Click=0）。
 */
export type EventScopeKey = string | number | symbol | object | Function;

/**
 * 默认作用域标记
 */
export const DEFAULT_EVENT_SCOPE: unique symbol = Symbol('DEFAULT_EVENT_SCOPE');

/**
 * 同步事件回调函数类型
 * 支持可选返回值：若显式返回 false，可在分发中中断后续回调链
 */
export type EventCallback<T = any> = (data: T, ...args: any[]) => void | boolean;

/**
 * 上下文目标有效性校验器类型（用于扩展支持引擎对象生命周期感知）
 */
export type EventTargetValidator = (target: any) => boolean;

/**
 * 添加事件监听器时的可选配置项
 */
export interface EventListenerOptions {
    /** 回调上下文（绑定 this 指针） */
    target?: any;

    /** 是否只监听一次后自动注销 */
    once?: boolean;

    /** 触发优先级（数字越大执行顺序越靠前，默认 0） */
    priority?: number;

    /** 所属枚举对象或命名空间作用域（避免跨枚举数值碰撞） */
    scope?: EventScopeKey;
}

/**
 * 监听项内部绑定结构
 */
export interface EventBinding<T = any> {
    /** 绑定唯一标识号 */
    readonly id: number;

    /** 原始事件标识 */
    readonly eventID: EventKey;

    /** 回调函数 */
    readonly callback: EventCallback<T>;

    /** 上下文目标（this） */
    readonly target?: any;

    /** 是否单次监听 */
    readonly once: boolean;

    /** 执行优先级 */
    readonly priority: number;

    /** 所属作用域/枚举对象 */
    readonly scope: EventScopeKey;

    /** 是否已被软标记移除（用于遍历中并发修改防御） */
    isRemoved: boolean;

    /** 触发调用累计次数（用于调试与统计） */
    callCount: number;
}

/**
 * 事件元数据对外信息接口（用于匹配器 matcher、调试与统计）
 * 对标 C# EventCenter.EventInfo
 */
export interface IEventInfo {
    /** 监听器内部唯一 ID */
    readonly id: number;

    /** 事件标识 */
    readonly eventID: EventKey;

    /** 所属枚举对象或作用域标识 */
    readonly scope: EventScopeKey;

    /** 绑定的上下文目标 */
    readonly target: any;

    /** 执行优先级 */
    readonly priority: number;

    /** 是否只触发一次 */
    readonly once: boolean;

    /** 注册的回调函数 */
    readonly listener: Function;

    /** 累计触发调用次数 */
    readonly callCount: number;
}

/**
 * 条件匹配器函数：接收事件信息，返回 true 表示应被移除
 * 对标 C# 中的 `Func<EventInfo, bool> matcher`
 */
export type EventMatcher = (info: IEventInfo) => boolean;

/**
 * 事件映射表基类约束（可用于用户自定义强类型字典推导）
 */
export type AnyEventMap = Record<EventKey, any>;

/**
 * 事件中心实例化配置选项
 */
export interface EventCenterOptions {
    /** 事件中心标识名称（用于调试与诊断 dump） */
    name?: string;

    /**
     * 可选的目标有效性校验钩子。
     * 分发事件前，若目标 target 存在，将调用此钩子校验；若返回 false，视为失效对象自动跳过调用并清理。
     * 例如在 Cocos 扩展中可注入 `(target) => isValid(target)`。
     */
    targetValidator?: EventTargetValidator;
}

/**
 * 事件中心核心契约接口
 */
export interface IEventCenter<TEventMap extends AnyEventMap = any> {
    /** 添加事件监听器 */
    addListener<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        options?: EventListenerOptions
    ): this;
    addListener<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        options?: EventListenerOptions
    ): this;

    /** 添加单次事件监听器（触发后自动注销） */
    addListenerOnce<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        priority?: number
    ): this;
    addListenerOnce<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        priority?: number
    ): this;

    /** 移除指定的事件监听器 */
    removeListener<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any
    ): boolean;
    removeListener<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any
    ): boolean;

    /** 移除某个目标（target/this）绑定的所有事件监听器 */
    removeByTarget(target: any): number;

    /** 移除某个作用域/枚举下的所有事件监听器 */
    removeByScope(scope: EventScopeKey): number;

    /** 严格触发事件（若事件未被监听则抛出异常，对标 C# TriggerEvent） */
    triggerEvent<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): void;
    triggerEvent<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): void;

    /** 尝试触发事件（若未被监听返回 false，不抛异常，对标 C# TryTriggerEvent） */
    tryTriggerEvent<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): boolean;
    tryTriggerEvent<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): boolean;

    /** 宽松派发事件（不抛异常，返回实际触发的监听器数量） */
    emit<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): number;
    emit<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): number;

    /** 检查是否包含某个事件的有效监听器（对标 C# ContainsEvent） */
    containsEvent<K extends keyof TEventMap>(eventID: K, scope?: EventScopeKey): boolean;

    /** 批量移除符合条件的事件（对标 C# RemoveEvent(matcher)） */
    removeEvent(matcher: EventMatcher): number;

    /** 清空所有已注册的事件 */
    clearAllEvents(): void;

    /** 获取监听器数量 */
    getListenerCount(eventID?: EventKey, scope?: EventScopeKey): number;

    /** 设置或替换目标有效性校验钩子 */
    setTargetValidator(validator: EventTargetValidator | null): this;

    /** 打印诊断字符串 */
    dump(): string;
}
