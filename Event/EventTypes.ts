/** 事件 token 的类型标记；事件名称只用于诊断，身份由对象引用决定。 */
const PAYLOAD = Symbol('EventPayload');
export interface EventToken<T> {
    readonly name: string;
    readonly [PAYLOAD]: (value: T) => T;
}

/** 声明一个独立、不可变的类型化事件。相同名称的 token 也互不相通。 */
export function createEvent<T = void>(name: string): EventToken<T> {
    if (!name.trim()) throw new Error('事件名称不能为空');
    return Object.freeze({ name, [PAYLOAD]: (value: T) => value });
}

/** 仅供模块内部检查运行时传入的事件身份。 */
export function assertEvent(token: unknown): asserts token is EventToken<unknown> {
    if (!token || typeof token !== 'object' || !(PAYLOAD in token)) throw new TypeError('请使用 createEvent 创建事件 token');
}

/** void 事件允许不传数据，其他事件必须提供完整载荷。 */
export type EventArguments<T> = void extends T ? [payload?: T] : [payload: T];
export type EventListener<T> = (payload: T) => void;

export interface Subscription {
    readonly closed: boolean;
    /** 幂等解绑，只影响本次注册。 */
    dispose(): void;
}

export interface EventOptions {
    /** 数值越大越先执行；同优先级按注册顺序执行。 */
    readonly priority?: number;
}

export interface EventFailure {
    readonly eventName: string;
    readonly subscriptionId: number;
    readonly error: unknown;
}

export interface EventCenterOptions {
    readonly name?: string;
    /** 提供后接管同步监听异常；处理器自己抛错仍会汇总抛出。 */
    readonly onError?: (failure: EventFailure) => void;
}

/** 同一轮所有监听先完成，再汇总未处理异常；不静默吞掉业务错误。 */
export class EventDispatchError extends Error {
    readonly failures: readonly EventFailure[];
    constructor(failures: readonly EventFailure[]) {
        super(`事件分发产生 ${failures.length} 个未处理异常`);
        this.name = 'EventDispatchError';
        this.failures = Object.freeze(failures.slice());
    }
}

export interface EventDiagnostic {
    readonly name: string;
    readonly disposed: boolean;
    readonly listenerCount: number;
    readonly events: readonly { readonly name: string; readonly listenerCount: number }[];
}

/** 内部订阅句柄：自动从所属作用域移除，避免长期存活的 once 作用域积累引用。 */
export class SubscriptionHandle implements Subscription {
    private release: (() => void) | undefined;
    private readonly owners = new Set<Set<SubscriptionHandle>>();
    constructor(release: () => void) { this.release = release; }
    get closed(): boolean { return this.release === undefined; }
    /** @internal 仅供 EventScope 管理订阅所有权。 */
    attach(owner: Set<SubscriptionHandle>): void {
        if (!this.closed) { owner.add(this); this.owners.add(owner); }
    }
    dispose(): void {
        const release = this.release;
        if (!release) return;
        this.release = undefined;
        for (const owner of this.owners) owner.delete(this);
        this.owners.clear();
        release();
    }
}
