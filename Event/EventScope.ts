import type { EventCenter } from './EventCenter';
import { EventListener, EventOptions, EventToken, Subscription, SubscriptionHandle } from './EventTypes';

/**
 * 订阅所有权袋，不是事件命名空间。两个作用域可以监听同一 token，互不代替或移除订阅。
 * 在 onEnable 创建，onDisable/dispose 释放；不修改 Component 原型。
 */
export class EventScope {
    private readonly subscriptions = new Set<SubscriptionHandle>();
    private disposed = false;
    constructor(private readonly center: EventCenter) {}
    get isDisposed(): boolean { return this.disposed; }
    get listenerCount(): number { return this.subscriptions.size; }
    on<T>(event: EventToken<T>, listener: EventListener<T>, options?: EventOptions): Subscription {
        this.assertAlive();
        const subscription = this.center.on(event, listener, options) as SubscriptionHandle;
        subscription.attach(this.subscriptions);
        return subscription;
    }
    once<T>(event: EventToken<T>, listener: EventListener<T>, options?: EventOptions): Subscription {
        this.assertAlive();
        const subscription = this.center.once(event, listener, options) as SubscriptionHandle;
        subscription.attach(this.subscriptions);
        return subscription;
    }
    /** 清空当前订阅但保留袋，可以再次注册。 */
    clear(): void { for (const subscription of this.subscriptions) subscription.dispose(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clear();
    }
    private assertAlive(): void { if (this.disposed) throw new Error('事件作用域已释放'); }
}
