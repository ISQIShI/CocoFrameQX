import { Component, isValid } from 'cc';
import { EventCenter } from './EventCenter';
import { EventScope } from './EventScope';
import { EventListener, EventOptions, EventToken, Subscription } from './EventTypes';

/**
 * Cocos 显式生命周期适配：在组件 onEnable/ onDisable/ onDestroy 调用同名方法。
 * 每次 enable 重建订阅，disable 释放；被延迟销毁的接收者不再执行回调。
 */
export class CocosEventBinding {
    private scope: EventScope | undefined;
    private disposed = false;
    constructor(private readonly center: EventCenter, private readonly receiver: Component,
        private readonly connect: (binding: CocosEventBinding) => void) {}

    enable(): void {
        if (this.disposed) throw new Error('Cocos 事件绑定已释放');
        if (this.scope || !isValid(this.receiver, true)) return;
        this.scope = this.center.createScope();
        try { this.connect(this); }
        catch (error) { this.disable(); throw error; }
    }
    disable(): void { const scope = this.scope; this.scope = undefined; scope?.dispose(); }
    dispose(): void { if (!this.disposed) { this.disposed = true; this.disable(); } }
    get listenerCount(): number { return this.scope?.listenerCount ?? 0; }

    on<T>(event: EventToken<T>, listener: EventListener<T>, options?: EventOptions): Subscription {
        return this.subscribe(event, listener, options, false);
    }
    once<T>(event: EventToken<T>, listener: EventListener<T>, options?: EventOptions): Subscription {
        return this.subscribe(event, listener, options, true);
    }
    private subscribe<T>(event: EventToken<T>, listener: EventListener<T>, options: EventOptions | undefined, once: boolean): Subscription {
        if (!this.scope) throw new Error('请在 enable 的 connect 回调中注册事件');
        const guarded = (payload: T): void => {
            if (!isValid(this.receiver, true)) { this.disable(); return; }
            listener(payload);
        };
        return once ? this.scope.once(event, guarded, options) : this.scope.on(event, guarded, options);
    }
}
