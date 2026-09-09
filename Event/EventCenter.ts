/**
 * CocoFrameQX - EventCenter
 * 高性能、类型安全、防重入、支持枚举隔离的纯 TypeScript 事件中心
 * 
 * 核心特性：
 * 1. 完整对标 UniFrameQX.EventCenter (C#) 的 API：
 *    - AddListener / RemoveListener (支持有参/无参/单次/优先级)
 *    - TriggerEvent / TryTriggerEvent (严格/宽容两种触发模式)
 *    - ContainsEvent (事件存在性检查)
 *    - RemoveEvent(matcher) (基于元数据的条件匹配批量移除)
 *    - ClearAllEvents (清空重置)
 * 2. 结合 TypeScript 特性：
 *    - 枚举隔离机制：解决 TS/JS 下不同数值枚举碰撞问题（如 GameEvent.Start=0 与 UIEvent.Click=0）
 *    - target (this) 上下文绑定与一键清理：removeByTarget(target) 支持针对特定目标的批量注销
 *    - 纯净无依赖：本体不耦合 Cocos 等任何特定引擎，提供 targetValidator 扩展钩子支持外部注入对象可用性检测
 *    - 遍历中并发修改安全（Re-entrancy Safety）：安全应对在事件回调内添加/删除监听的边界情况
 *    - 内置优先级（Priority）、单次监听（Once）、中断传播（return false）与调试诊断（Dump）
 * 3. 专注纯粹实例职责：
 *    - 不在本体内混入全局静态单例与全局门面，全局访问交由专门的单例类或定位器托管
 */

import {
    EventKey,
    EventScopeKey,
    EventCallback,
    EventListenerOptions,
    EventBinding,
    IEventInfo,
    EventMatcher,
    AnyEventMap,
    IEventCenter,
    DEFAULT_EVENT_SCOPE,
    EventCenterOptions,
    EventTargetValidator
} from './EventTypes';
import { EventScope } from './EventScope';

export class EventCenter<TEventMap extends AnyEventMap = any> implements IEventCenter<TEventMap> {
    // ==========================================
    // 作用域/枚举类型隔离唯一标识生成器（无状态纯算法）
    // ==========================================

    private static _scopeIdCounter: number = 0;
    private static readonly _scopeWeakMap: WeakMap<object, string> = new WeakMap();

    /**
     * 将任意作用域/枚举对象解析为稳定的唯一字符串 Key
     */
    public static getScopeIdentifier(scope?: EventScopeKey): string {
        if (scope === undefined || scope === null || scope === DEFAULT_EVENT_SCOPE) {
            return '__default__';
        }
        if (typeof scope === 'string') {
            return `str:${scope}`;
        }
        if (typeof scope === 'number') {
            return `num:${scope}`;
        }
        if (typeof scope === 'symbol') {
            return `sym:${scope.toString()}`;
        }
        if (typeof scope === 'object' || typeof scope === 'function') {
            let id = EventCenter._scopeWeakMap.get(scope);
            if (!id) {
                const name = (scope as any).name || (scope.constructor ? scope.constructor.name : 'AnonymousScope');
                id = `obj:${name}_${++EventCenter._scopeIdCounter}`;
                EventCenter._scopeWeakMap.set(scope, id);
            }
            return id;
        }
        return `other:${String(scope)}`;
    }

    /**
     * 生成复合事件索引键，将作用域与事件ID组合，实现 O(1) 隔离定位
     */
    public static getCompositeKey(scope: EventScopeKey | undefined, eventID: EventKey): string {
        const scopeStr = EventCenter.getScopeIdentifier(scope);
        const eventStr = typeof eventID === 'symbol' ? eventID.toString() : String(eventID);
        return `${scopeStr}::${eventStr}`;
    }

    // ==========================================
    // 实例成员与状态
    // ==========================================

    /** 事件中心标识名称（用于调试诊断） */
    public readonly name: string;

    /** 可选的目标有效性校验钩子（可通过扩展模块或配置项注入） */
    private _targetValidator?: EventTargetValidator;

    /** 自增绑定 ID */
    private _nextBindingId: number = 1;

    /** 核心事件表：复合键 => 排序监听列表 */
    private readonly _eventTable: Map<string, EventBinding[]> = new Map();

    /** 快速反查表：target => Set<EventBinding>，实现高效 removeByTarget */
    private readonly _targetBindingMap: Map<any, Set<EventBinding>> = new Map();

    /** 分发嵌套深度计数器，用于防重入安全与延迟紧缩压缩 */
    private _dispatchDepth: number = 0;

    /** 是否有待延迟清理的软删除项 */
    private _hasPendingPruning: boolean = false;

    public constructor(options?: EventCenterOptions | string) {
        if (typeof options === 'string') {
            this.name = options;
        } else if (options) {
            this.name = options.name || 'EventCenter';
            this._targetValidator = options.targetValidator;
        } else {
            this.name = 'EventCenter';
        }
    }

    /**
     * 配置或更新上下文目标有效性校验钩子
     */
    public setTargetValidator(validator: EventTargetValidator | null): this {
        this._targetValidator = validator || undefined;
        return this;
    }

    // ==========================================
    // 监听器注册 API
    // ==========================================

    /**
     * 添加事件监听器
     * 支持多种重载调用风格：
     * 1. 基础调用：`addListener(GameEvent.PlayerSpawn, this.onSpawn, this)`
     * 2. 枚举隔离调用：`addListener(GameEvent, GameEvent.PlayerSpawn, this.onSpawn, this)`
     * 3. 详细配置项调用：`addListener(GameEvent.PlayerSpawn, this.onSpawn, this, { priority: 10, once: true })`
     */
    public addListener<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        options?: EventListenerOptions
    ): this;
    public addListener<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        options?: EventListenerOptions
    ): this;
    public addListener(...args: any[]): this {
        const parsed = this._parseListenerArgs(args);
        return this._internalAdd(parsed.scope, parsed.eventID, parsed.listener, parsed.target, parsed.options);
    }

    /**
     * 添加单次事件监听器（触发一次后自动注销）
     */
    public addListenerOnce<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        priority?: number
    ): this;
    public addListenerOnce<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any,
        priority?: number
    ): this;
    public addListenerOnce(...args: any[]): this {
        const parsed = this._parseListenerArgs(args);
        const options: EventListenerOptions = {
            ...parsed.options,
            once: true
        };
        if (typeof parsed.extra === 'number') {
            options.priority = parsed.extra;
        }
        return this._internalAdd(parsed.scope, parsed.eventID, parsed.listener, parsed.target, options);
    }

    // ==========================================
    // 监听器移除 API
    // ==========================================

    /**
     * 移除指定的事件监听器
     * 支持指定 target 精确移除，亦支持不传 target 移除所有该回调
     */
    public removeListener<K extends keyof TEventMap>(
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any
    ): boolean;
    public removeListener<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        listener: EventCallback<TEventMap[K]>,
        target?: any
    ): boolean;
    public removeListener(...args: any[]): boolean {
        let scope: EventScopeKey = DEFAULT_EVENT_SCOPE;
        let eventID: EventKey;
        let listener: EventCallback;
        let target: any;

        if (typeof args[1] === 'function') {
            eventID = args[0];
            listener = args[1];
            target = args[2];
        } else {
            scope = args[0];
            eventID = args[1];
            listener = args[2];
            target = args[3];
        }

        if (!listener) {
            throw new Error('[EventCenter] 待移除的事件监听器不能为空');
        }

        const compositeKey = EventCenter.getCompositeKey(scope, eventID);
        const list = this._eventTable.get(compositeKey);
        if (!list || list.length === 0) {
            return false;
        }

        let removed = false;
        for (let i = 0; i < list.length; i++) {
            const binding = list[i];
            if (binding.isRemoved) continue;

            const callbackMatch = binding.callback === listener;
            const targetMatch = target === undefined || binding.target === target;

            if (callbackMatch && targetMatch) {
                this._markBindingRemoved(binding, list);
                removed = true;
            }
        }

        this._tryPrune();
        return removed;
    }

    /**
     * 移除特定目标（如 Component / Controller 实例）绑定的所有事件监听器
     * @param target 目标上下文实例
     * @returns 成功移除的监听项数量
     */
    public removeByTarget(target: any): number {
        if (!target) return 0;

        const targetSet = this._targetBindingMap.get(target);
        if (!targetSet || targetSet.size === 0) {
            return 0;
        }

        let count = 0;
        const bindings = Array.from(targetSet);
        for (const binding of bindings) {
            if (!binding.isRemoved) {
                const compositeKey = EventCenter.getCompositeKey(binding.scope, binding.eventID);
                const list = this._eventTable.get(compositeKey);
                this._markBindingRemoved(binding, list);
                count++;
            }
        }

        this._targetBindingMap.delete(target);
        this._tryPrune();
        return count;
    }

    /**
     * removeByTarget 的别名
     */
    public targetOff(target: any): number {
        return this.removeByTarget(target);
    }

    /**
     * 移除指定作用域/枚举下的所有事件监听器
     * @param scope 所属枚举或命名空间作用域
     * @returns 移除的监听器总数
     */
    public removeByScope(scope: EventScopeKey): number {
        const scopeStr = EventCenter.getScopeIdentifier(scope);
        const prefix = `${scopeStr}::`;
        let count = 0;

        for (const [key, list] of this._eventTable.entries()) {
            if (key.startsWith(prefix)) {
                for (const binding of list) {
                    if (!binding.isRemoved) {
                        this._markBindingRemoved(binding, list);
                        count++;
                    }
                }
            }
        }

        this._tryPrune();
        return count;
    }

    // ==========================================
    // 事件分发与触发 API (同步)
    // ==========================================

    /**
     * 严格触发事件（对标 C# TriggerEvent）
     * 若该事件当前没有被任何监听器监听，将直接抛出异常
     */
    public triggerEvent<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): void;
    public triggerEvent<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): void;
    public triggerEvent(...args: any[]): void {
        const { scope, eventID, data, extraArgs } = this._parseTriggerArgs(args);
        const triggeredCount = this._dispatch(scope, eventID, data, extraArgs);
        if (triggeredCount === 0) {
            const keyDesc = EventCenter.getCompositeKey(scope, eventID);
            throw new Error(`[EventCenter] 尝试触发未被监听的事件: [${keyDesc}]`);
        }
    }

    /**
     * 尝试触发事件（对标 C# TryTriggerEvent）
     * 若该事件未被监听，返回 false，不抛出异常
     * @returns true: 成功触发至少一个监听器；false: 事件不存在监听者
     */
    public tryTriggerEvent<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): boolean;
    public tryTriggerEvent<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): boolean;
    public tryTriggerEvent(...args: any[]): boolean {
        const { scope, eventID, data, extraArgs } = this._parseTriggerArgs(args);
        return this._dispatch(scope, eventID, data, extraArgs) > 0;
    }

    /**
     * 宽松触发事件
     * 无论是否有监听者均不抛异常，返回实际执行的监听器数量
     */
    public emit<K extends keyof TEventMap>(
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): number;
    public emit<K extends keyof TEventMap>(
        scope: EventScopeKey,
        eventID: K,
        data?: TEventMap[K],
        ...args: any[]
    ): number;
    public emit(...args: any[]): number {
        const { scope, eventID, data, extraArgs } = this._parseTriggerArgs(args);
        return this._dispatch(scope, eventID, data, extraArgs);
    }

    // ==========================================
    // 查询与元数据匹配 API
    // ==========================================

    /**
     * 检查事件是否包含活跃的监听器（对标 C# ContainsEvent）
     */
    public containsEvent<K extends keyof TEventMap>(eventID: K, scope?: EventScopeKey): boolean {
        const compositeKey = EventCenter.getCompositeKey(scope, eventID as any);
        const list = this._eventTable.get(compositeKey);
        if (!list || list.length === 0) return false;
        return list.some(b => !b.isRemoved);
    }

    /**
     * 基于匹配器条件批量移除事件（对标 C# RemoveEvent(matcher)）
     * 允许基于事件ID、所属作用域/枚举、Target、执行次数、优先级等灵活匹配
     * @param matcher 匹配函数，返回 true 的监听器将被注销
     * @returns 成功移除的监听器总数
     */
    public removeEvent(matcher: EventMatcher): number {
        if (typeof matcher !== 'function') {
            throw new Error('[EventCenter] matcher 必须为有效函数');
        }

        let removedCount = 0;
        for (const [_, list] of this._eventTable.entries()) {
            for (let i = 0; i < list.length; i++) {
                const binding = list[i];
                if (binding.isRemoved) continue;

                const info: IEventInfo = {
                    id: binding.id,
                    eventID: binding.eventID,
                    scope: binding.scope,
                    target: binding.target,
                    priority: binding.priority,
                    once: binding.once,
                    listener: binding.callback,
                    callCount: binding.callCount
                };

                if (matcher(info)) {
                    this._markBindingRemoved(binding, list);
                    removedCount++;
                }
            }
        }

        this._tryPrune();
        return removedCount;
    }

    /**
     * 清空所有事件监听器（对标 C# ClearAllEvents）
     */
    public clearAllEvents(): void {
        for (const list of this._eventTable.values()) {
            for (const binding of list) {
                binding.isRemoved = true;
            }
        }
        this._eventTable.clear();
        this._targetBindingMap.clear();
        this._hasPendingPruning = false;
    }

    /**
     * 获取当前注册的监听器数量
     * @param eventID 可选，不传时统计中心所有事件的监听总数
     * @param scope 可选，所属作用域/枚举
     */
    public getListenerCount(eventID?: EventKey, scope?: EventScopeKey): number {
        if (eventID !== undefined) {
            const compositeKey = EventCenter.getCompositeKey(scope, eventID);
            const list = this._eventTable.get(compositeKey);
            if (!list) return 0;
            return list.filter(b => !b.isRemoved).length;
        }

        let total = 0;
        for (const list of this._eventTable.values()) {
            for (const binding of list) {
                if (!binding.isRemoved) total++;
            }
        }
        return total;
    }

    /**
     * 创建一个绑定的事件作用域（EventScope）
     * 方便在局部窗口、战斗阶段或生命周期明确的模块中独立挂载并实现退出时一键销毁
     */
    public createScope(name?: string, defaultTarget?: any): EventScope {
        return new EventScope(this, defaultTarget, name);
    }

    // ==========================================
    // 内部实现：分发、安全与状态控制
    // ==========================================

    private _internalAdd(
        scope: EventScopeKey,
        eventID: EventKey,
        listener: EventCallback,
        target: any,
        options?: EventListenerOptions
    ): this {
        if (typeof listener !== 'function') {
            throw new Error(`[EventCenter] 事件监听器必须为有效函数，当前收到: ${typeof listener}`);
        }

        const effectiveScope = options?.scope !== undefined ? options.scope : scope;
        const priority = options?.priority ?? 0;
        const once = options?.once ?? false;
        const compositeKey = EventCenter.getCompositeKey(effectiveScope, eventID);

        let list = this._eventTable.get(compositeKey);
        if (!list) {
            list = [];
            this._eventTable.set(compositeKey, list);
        }

        // 防御重复注册相同 (callback + target)
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (!b.isRemoved && b.callback === listener && b.target === target) {
                return this;
            }
        }

        const binding: EventBinding = {
            id: this._nextBindingId++,
            eventID,
            callback: listener,
            target,
            once,
            priority,
            scope: effectiveScope,
            isRemoved: false,
            callCount: 0
        };

        // 按 priority 降序插入，保证触发时 O(1) 免排序
        let insertIndex = list.length;
        for (let i = 0; i < list.length; i++) {
            if (priority > list[i].priority) {
                insertIndex = i;
                break;
            }
        }
        list.splice(insertIndex, 0, binding);

        // 维护 target 反查表
        if (target) {
            let targetSet = this._targetBindingMap.get(target);
            if (!targetSet) {
                targetSet = new Set();
                this._targetBindingMap.set(target, targetSet);
            }
            targetSet.add(binding);
        }

        return this;
    }

    /**
     * 同步分发执行引擎
     * 具备：快照安全、target 有效性校验防御、中断支持、单次自动标记
     */
    private _dispatch(
        scope: EventScopeKey,
        eventID: EventKey,
        data: any,
        extraArgs: any[]
    ): number {
        const compositeKey = EventCenter.getCompositeKey(scope, eventID);
        const list = this._eventTable.get(compositeKey);
        if (!list || list.length === 0) return 0;

        // 浅拷贝快照：防止遍历中添加新监听导致当前轮次死循环或乱序
        const snapshot = list.slice();
        let executedCount = 0;

        this._dispatchDepth++;
        try {
            for (let i = 0; i < snapshot.length; i++) {
                const binding = snapshot[i];
                if (binding.isRemoved) continue;

                // 目标有效性校验（如外部注入了 Cocos isValid 校验）
                if (binding.target && this._targetValidator && !this._targetValidator(binding.target)) {
                    this._markBindingRemoved(binding, list);
                    continue;
                }

                binding.callCount++;
                executedCount++;

                if (binding.once) {
                    this._markBindingRemoved(binding, list);
                }

                try {
                    const result = binding.callback.call(binding.target, data, ...extraArgs);
                    // 若回调显式返回 false，则拦截并中断后续监听器传播
                    if (result === false) {
                        break;
                    }
                } catch (err) {
                    console.error(`[EventCenter] 执行事件监听回调异常 [${compositeKey}]:`, err);
                }
            }
        } finally {
            this._dispatchDepth--;
            this._tryPrune();
        }

        return executedCount;
    }

    /**
     * 标记监听项已被移除
     */
    private _markBindingRemoved(binding: EventBinding, inList?: EventBinding[]): void {
        binding.isRemoved = true;
        this._hasPendingPruning = true;

        if (binding.target) {
            const targetSet = this._targetBindingMap.get(binding.target);
            if (targetSet) {
                targetSet.delete(binding);
                if (targetSet.size === 0) {
                    this._targetBindingMap.delete(binding.target);
                }
            }
        }

        // 若当前未在分发循环中，直接物理移除释放引用
        if (this._dispatchDepth === 0 && inList) {
            const idx = inList.indexOf(binding);
            if (idx !== -1) {
                inList.splice(idx, 1);
            }
        }
    }

    /**
     * 紧缩清理所有已被软标记移除的监听项，在分发深度归零时执行
     */
    private _tryPrune(): void {
        if (this._dispatchDepth > 0 || !this._hasPendingPruning) {
            return;
        }

        for (const [key, list] of this._eventTable.entries()) {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].isRemoved) {
                    list.splice(i, 1);
                }
            }
            if (list.length === 0) {
                this._eventTable.delete(key);
            }
        }

        this._hasPendingPruning = false;
    }

    // ==========================================
    // 参数重载解析辅助函数
    // ==========================================

    private _parseListenerArgs(args: any[]): {
        scope: EventScopeKey;
        eventID: EventKey;
        listener: EventCallback;
        target: any;
        options?: EventListenerOptions;
        extra?: any;
    } {
        let scope: EventScopeKey = DEFAULT_EVENT_SCOPE;
        let eventID: EventKey;
        let listener: EventCallback;
        let target: any;
        let options: EventListenerOptions | undefined;
        let extra: any;

        // 若第 2 个参数是函数，则为常用形式: (eventID, listener, target, options?)
        if (typeof args[1] === 'function') {
            eventID = args[0];
            listener = args[1];
            target = args[2];
            if (args[3] && typeof args[3] === 'object') {
                options = args[3];
            } else if (typeof args[3] === 'number') {
                options = { priority: args[3], once: Boolean(args[4]) };
            }
            extra = args[3];
        } else {
            // 第 3 个参数是函数，则包含显式 scope 隔离: (scope, eventID, listener, target, options?)
            scope = args[0];
            eventID = args[1];
            listener = args[2];
            target = args[3];
            if (args[4] && typeof args[4] === 'object') {
                options = args[4];
            } else if (typeof args[4] === 'number') {
                options = { priority: args[4], once: Boolean(args[5]) };
            }
            extra = args[4];
        }

        return { scope, eventID, listener, target, options, extra };
    }

    private _parseTriggerArgs(args: any[]): {
        scope: EventScopeKey;
        eventID: EventKey;
        data: any;
        extraArgs: any[];
    } {
        if (
            args.length >= 2 &&
            args[0] !== null &&
            args[0] !== undefined &&
            (typeof args[0] === 'object' || typeof args[0] === 'function') &&
            (typeof args[1] === 'string' || typeof args[1] === 'number' || typeof args[1] === 'symbol')
        ) {
            return {
                scope: args[0],
                eventID: args[1],
                data: args[2],
                extraArgs: args.slice(3)
            };
        }

        return {
            scope: DEFAULT_EVENT_SCOPE,
            eventID: args[0],
            data: args[1],
            extraArgs: args.slice(2)
        };
    }

    // ==========================================
    // 调试与诊断 API
    // ==========================================

    /**
     * 生成当前事件中心的可读状态诊断字符串
     */
    public dump(): string {
        const lines: string[] = [];
        lines.push(`📡 EventCenter [${this.name}] (Total Registered: ${this.getListenerCount()})`);

        if (this._eventTable.size === 0) {
            lines.push('  (No Registered Events)');
            return lines.join('\n');
        }

        for (const [compositeKey, list] of this._eventTable.entries()) {
            const activeCount = list.filter(b => !b.isRemoved).length;
            lines.push(`  🔔 [${compositeKey}] (Active Listeners: ${activeCount})`);
            for (const b of list) {
                if (b.isRemoved) continue;
                const targetName = b.target
                    ? (b.target.constructor?.name || typeof b.target)
                    : 'Global';
                const flags = [
                    b.once ? 'Once' : null,
                    b.priority !== 0 ? `P:${b.priority}` : null,
                    `Calls:${b.callCount}`
                ].filter(Boolean).join(', ');

                lines.push(`    - #${b.id} Target: [${targetName}], Flags: [${flags}]`);
            }
        }

        return lines.join('\n');
    }

    /**
     * 控制台打印诊断树
     */
    public printDiagnostics(): void {
        console.log(this.dump());
    }
}
