/**
 * CocoFrameQX - EventScope
 * 作用域事件代理与生命周期托管总线
 * 
 * 核心特性：
 * 1. 自动 target 上下文注入：如果构造时指定了 defaultTarget，通过本作用域注册的监听器将默认绑定该 target。
 * 2. 托管式全量注销：在局部场景、UI 弹窗、战斗回合或子系统销毁时，只需调用 `scope.dispose()` 或 `scope.clearAllEvents()`，
 *    即可一键将其在父级 EventCenter 中注册的所有事件清理干净，彻底杜绝遗漏。
 * 3. 独立且透明：完全兼容 EventCenter 的 API 风格（支持泛型推导与强类型契约）。
 * 4. 纯 TypeScript 实现，无任何引擎依赖。
 */

import {
    EventKey,
    EventScopeKey,
    EventCallback,
    EventListenerOptions,
    IEventCenter,
    AnyEventMap,
    EventTargetValidator
} from './EventTypes';
import type { EventCenter } from './EventCenter';

interface ScopedRecord {
    scope: EventScopeKey;
    eventID: EventKey;
    listener: EventCallback;
    target: any;
}

export class EventScope<TEventMap extends AnyEventMap = any> implements IEventCenter<TEventMap> {
    /** 所属的底层事件中心 */
    public readonly center: EventCenter<TEventMap>;

    /** 默认上下文对象（如 Component 或 Controller 实例） */
    public readonly defaultTarget?: any;

    /** 作用域标识名称 */
    public readonly name: string;

    /** 是否已注销 */
    private _isDisposed: boolean = false;
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /** 当前作用域所注册的全部监听条目，用于一键逆向清理 */
    private readonly _records: ScopedRecord[] = [];

    public constructor(center: EventCenter<TEventMap>, defaultTarget?: any, name?: string) {
        this.center = center;
        this.defaultTarget = defaultTarget;
        this.name = name || (defaultTarget?.constructor?.name ? `Scope_${defaultTarget.constructor.name}` : 'AnonymousScope');
    }

    /**
     * 添加事件监听器（支持默认 target 上下文注入）
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
        this._assertNotDisposed();

        let scope: EventScopeKey;
        let eventID: EventKey;
        let listener: EventCallback;
        let target: any;
        let options: EventListenerOptions | undefined;

        if (typeof args[1] === 'function') {
            eventID = args[0];
            listener = args[1];
            target = args[2] !== undefined ? args[2] : this.defaultTarget;
            options = args[3];
            scope = options?.scope;
        } else {
            scope = args[0];
            eventID = args[1];
            listener = args[2];
            target = args[3] !== undefined ? args[3] : this.defaultTarget;
            options = args[4];
        }

        // 调用底层中心注册
        (this.center.addListener as any)(scope, eventID, listener, target, options);

        // 记录在当前作用域中
        this._records.push({
            scope: options?.scope !== undefined ? options.scope : scope,
            eventID,
            listener,
            target
        });

        return this;
    }

    /**
     * 添加单次事件监听器
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
        this._assertNotDisposed();

        let scope: EventScopeKey;
        let eventID: EventKey;
        let listener: EventCallback;
        let target: any;
        let priority: number | undefined;

        if (typeof args[1] === 'function') {
            eventID = args[0];
            listener = args[1];
            target = args[2] !== undefined ? args[2] : this.defaultTarget;
            priority = args[3];
            (this.center.addListenerOnce as any)(eventID, listener, target, priority);
        } else {
            scope = args[0];
            eventID = args[1];
            listener = args[2];
            target = args[3] !== undefined ? args[3] : this.defaultTarget;
            priority = args[4];
            (this.center.addListenerOnce as any)(scope, eventID, listener, target, priority);
        }

        this._records.push({
            scope,
            eventID,
            listener,
            target
        });

        return this;
    }

    /**
     * 移除指定的事件监听器
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
        if (this._isDisposed) return false;

        let scope: EventScopeKey;
        let eventID: EventKey;
        let listener: EventCallback;
        let target: any;

        if (typeof args[1] === 'function') {
            eventID = args[0];
            listener = args[1];
            target = args[2] !== undefined ? args[2] : this.defaultTarget;
        } else {
            scope = args[0];
            eventID = args[1];
            listener = args[2];
            target = args[3] !== undefined ? args[3] : this.defaultTarget;
        }

        const success = (this.center.removeListener as any)(scope, eventID, listener, target);

        // 从本地跟踪中移除
        for (let i = this._records.length - 1; i >= 0; i--) {
            const r = this._records[i];
            if (r.eventID === eventID && r.listener === listener && (target === undefined || r.target === target)) {
                this._records.splice(i, 1);
            }
        }

        return success;
    }

    public removeByTarget(target: any): number {
        if (this._isDisposed) return 0;
        let count = 0;
        for (let i = this._records.length - 1; i >= 0; i--) {
            const r = this._records[i];
            if (r.target === target) {
                (this.center.removeListener as any)(r.scope, r.eventID, r.listener, r.target);
                this._records.splice(i, 1);
                count++;
            }
        }
        return count;
    }

    public removeByScope(scope: EventScopeKey): number {
        if (this._isDisposed) return 0;
        let count = 0;
        for (let i = this._records.length - 1; i >= 0; i--) {
            const r = this._records[i];
            if (r.scope === scope) {
                (this.center.removeListener as any)(r.scope, r.eventID, r.listener, r.target);
                this._records.splice(i, 1);
                count++;
            }
        }
        return count;
    }

    public triggerEvent<K extends keyof TEventMap>(eventID: K, data?: TEventMap[K], ...args: any[]): void;
    public triggerEvent<K extends keyof TEventMap>(scope: EventScopeKey, eventID: K, data?: TEventMap[K], ...args: any[]): void;
    public triggerEvent(...args: any[]): void {
        this._assertNotDisposed();
        (this.center.triggerEvent as any)(...args);
    }

    public tryTriggerEvent<K extends keyof TEventMap>(eventID: K, data?: TEventMap[K], ...args: any[]): boolean;
    public tryTriggerEvent<K extends keyof TEventMap>(scope: EventScopeKey, eventID: K, data?: TEventMap[K], ...args: any[]): boolean;
    public tryTriggerEvent(...args: any[]): boolean {
        if (this._isDisposed) return false;
        return (this.center.tryTriggerEvent as any)(...args);
    }

    public emit<K extends keyof TEventMap>(eventID: K, data?: TEventMap[K], ...args: any[]): number;
    public emit<K extends keyof TEventMap>(scope: EventScopeKey, eventID: K, data?: TEventMap[K], ...args: any[]): number;
    public emit(...args: any[]): number {
        if (this._isDisposed) return 0;
        return (this.center.emit as any)(...args);
    }

    public containsEvent<K extends keyof TEventMap>(eventID: K, scope?: EventScopeKey): boolean {
        if (this._isDisposed) return false;
        return this.center.containsEvent(eventID, scope);
    }

    public removeEvent(matcher: (info: any) => boolean): number {
        if (this._isDisposed) return 0;
        return this.center.removeEvent(matcher);
    }

    /**
     * 清空当前作用域注册过的所有事件监听器
     */
    public clearAllEvents(): void {
        while (this._records.length > 0) {
            const r = this._records.pop()!;
            (this.center.removeListener as any)(r.scope, r.eventID, r.listener, r.target);
        }
    }

    /**
     * 注销当前作用域，清空关联的所有事件监听器
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this.clearAllEvents();
        this._isDisposed = true;
    }

    public getListenerCount(eventID?: EventKey, scope?: EventScopeKey): number {
        if (this._isDisposed) return 0;
        return this.center.getListenerCount(eventID, scope);
    }

    public setTargetValidator(validator: EventTargetValidator | null): this {
        this.center.setTargetValidator(validator);
        return this;
    }

    public dump(): string {
        return `Scope [${this.name}] (Disposed: ${this._isDisposed}, Tracked Records: ${this._records.length})\n` + this.center.dump();
    }

    private _assertNotDisposed(): void {
        if (this._isDisposed) {
            throw new Error(`[EventScope] 作用域 [${this.name}] 已经处于 Disposed 状态，禁止继续操作`);
        }
    }
}
