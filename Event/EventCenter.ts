import { assertEvent, EventArguments, EventCenterOptions, EventDiagnostic, EventDispatchError, EventFailure,
    EventListener, EventOptions, EventToken, Subscription, SubscriptionHandle } from './EventTypes';
import { EventScope } from './EventScope';

interface Entry {
    readonly id: number;
    readonly priority: number;
    readonly once: boolean;
    readonly handle: SubscriptionHandle;
    callback: ((payload: unknown) => void) | undefined;
}

/**
 * 同步类型化事件中心。没有全局实例、隐式命名空间或引擎生命周期劫持。
 * 注册/解绑时复制列表，分发直接读取稳定快照；新增监听不进入当前轮，解绑立即生效。
 */
export class EventCenter {
    readonly name: string;
    private readonly onError?: (failure: EventFailure) => void;
    private readonly channels = new Map<object, { name: string; entries: readonly Entry[] }>();
    private nextId = 1;
    private disposed = false;
    private count = 0;

    constructor(options: EventCenterOptions = {}) {
        this.name = options.name ?? 'EventCenter';
        this.onError = options.onError;
    }
    get isDisposed(): boolean { return this.disposed; }
    get listenerCount(): number { return this.count; }

    on<T>(event: EventToken<T>, listener: EventListener<T>, options: EventOptions = {}): Subscription {
        return this.subscribe(event, listener, options, false);
    }
    once<T>(event: EventToken<T>, listener: EventListener<T>, options: EventOptions = {}): Subscription {
        return this.subscribe(event, listener, options, true);
    }
    createScope(): EventScope { this.assertAlive(); return new EventScope(this); }

    /** 返回本次实际调用的监听数；没有监听时返回零。同步异常完成本轮后汇总抛出。 */
    emit<T>(event: EventToken<T>, ...args: EventArguments<T>): number {
        this.assertAlive();
        assertEvent(event);
        const snapshot = this.channels.get(event)?.entries;
        if (!snapshot) return 0;
        const failures: EventFailure[] = [];
        let invoked = 0;
        for (const entry of snapshot) {
            if (entry.handle.closed) continue;
            const callback = entry.callback!;
            // 先解绑再回调，使递归 emit 或回调抛错仍严格只执行一次。
            if (entry.once) entry.handle.dispose();
            invoked++;
            try { callback(args[0]); }
            catch (error) {
                const failure = Object.freeze({ eventName: event.name, subscriptionId: entry.id, error });
                if (!this.onError) failures.push(failure);
                else {
                    try { this.onError(failure); }
                    catch (reportError) {
                        failures.push(failure, Object.freeze({ eventName: event.name, subscriptionId: entry.id, error: reportError }));
                    }
                }
            }
        }
        if (failures.length) throw new EventDispatchError(failures);
        return invoked;
    }

    /** 清除一个事件的全部订阅；无参数时清除整个中心，已有句柄同步变为 closed。 */
    clear<T>(event?: EventToken<T>): void {
        if (event !== undefined) {
            assertEvent(event);
            const channel = this.channels.get(event);
            if (channel) {
                this.channels.delete(event);
                this.count -= channel.entries.length;
                for (const entry of channel.entries) entry.handle.dispose();
            }
        } else {
            const channels = Array.from(this.channels.values());
            this.channels.clear();
            this.count = 0;
            for (const channel of channels) for (const entry of channel.entries) entry.handle.dispose();
        }
    }

    /** 幂等关闭，之后禁止注册、创建作用域和分发。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clear();
    }

    /** 返回不可变统计快照，不暴露回调或可变内部集合。 */
    inspect(): EventDiagnostic {
        const events = Array.from(this.channels.values(), channel => Object.freeze({ name: channel.name, listenerCount: channel.entries.length }));
        return Object.freeze({ name: this.name, disposed: this.disposed, listenerCount: this.count, events: Object.freeze(events) });
    }

    private subscribe<T>(event: EventToken<T>, listener: EventListener<T>, options: EventOptions, once: boolean): SubscriptionHandle {
        this.assertAlive();
        assertEvent(event);
        if (typeof listener !== 'function') throw new TypeError('事件监听必须为函数');
        const priority = options.priority ?? 0;
        if (!Number.isFinite(priority)) throw new RangeError('事件优先级必须为有限数值');
        const handle = new SubscriptionHandle(() => {
            entry.callback = undefined;
            const channel = this.channels.get(event);
            if (!channel) return;
            const remaining = channel.entries.filter(value => value !== entry);
            if (remaining.length) this.channels.set(event, { name: channel.name, entries: remaining });
            else this.channels.delete(event);
            this.count--;
        });
        const entry: Entry = { id: this.nextId++, priority, once, handle, callback: listener as (payload: unknown) => void };
        const entries = this.channels.get(event)?.entries ?? [];
        const index = entries.findIndex(value => value.priority < priority);
        const split = index < 0 ? entries.length : index;
        this.channels.set(event, { name: event.name, entries: [...entries.slice(0, split), entry, ...entries.slice(split)] });
        this.count++;
        return handle;
    }
    private assertAlive(): void { if (this.disposed) throw new Error(`事件中心 ${this.name} 已释放`); }
}
