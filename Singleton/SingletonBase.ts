/**
 * 普通 TypeScript 类的单例基类。
 *
 * 与 ComponentSingletonBase 的区别：普通类没有 Cocos 节点、场景和组件生命周期，
 * 因此实例会在构造函数中立即注册，并通过 destroy() 显式注销。
 */
export abstract class SingletonBase {
    /**
     * 类配置：调用 getInstance() 发现实例缺失时是否自动创建。
     * 子类如需启用，声明：`public static override autoCreate = true;`
     */
    public static autoCreate: boolean = false;

    // 存储各个具体派生类的单例实例，按构造函数隔离。
    private static readonly _instanceMap: Map<Function, SingletonBase> = new Map();

    /**
     * 获取单例实例。
     * 实例缺失时，仅在当前类配置了 autoCreate = true 的情况下自动创建。
     */
    public static getInstance<T extends SingletonBase>(this: new (...args: any[]) => T): T {
        const instance = SingletonBase._instanceMap.get(this);
        if (instance) {
            return instance as T;
        }

        const ctor = this as unknown as typeof SingletonBase;
        if (ctor.autoCreate) {
            return SingletonBase._createInstance(this);
        }

        return null as unknown as T;
    }

    /**
     * 判断单例实例是否存在。
     */
    public static hasInstance<T extends SingletonBase>(this: new (...args: any[]) => T): boolean {
        return SingletonBase._instanceMap.has(this);
    }

    /**
     * 强制获取或自动创建单例实例，忽略 autoCreate 配置。
     */
    public static getOrCreateInstance<T extends SingletonBase>(this: new (...args: any[]) => T): T {
        const instance = SingletonBase._instanceMap.get(this);
        if (instance) {
            return instance as T;
        }

        return SingletonBase._createInstance(this);
    }

    /**
     * 创建单例实例。
     */
    protected static _createInstance<T extends SingletonBase>(ctor: new (...args: any[]) => T): T {
        // 二次防御，避免调用方在创建前后重复检查导致重复实例。
        const existing = SingletonBase._instanceMap.get(ctor);
        if (existing) {
            return existing as T;
        }

        return new ctor();
    }

    protected constructor() {
        this._registerSingleton();
    }

    /**
     * 注销当前单例并调用销毁钩子。
     * 重复调用安全无副作用。
     */
    public destroy(): void {
        const ctor = this.constructor;
        if (SingletonBase._instanceMap.get(ctor) !== this) {
            return;
        }

        SingletonBase._instanceMap.delete(ctor);
        this.onSingletonDestroy?.();
    }

    /**
     * 注册当前实例。
     * 普通类没有 Cocos 的 destroy API，重复实例直接抛出错误，避免继续使用无效实例。
     */
    private _registerSingleton(): void {
        const ctor = this.constructor;
        const currentInstance = SingletonBase._instanceMap.get(ctor);
        if (currentInstance && currentInstance !== this) {
            throw new Error(`[SingletonBase] 已经存在 ${ctor.name} 类型的有效实例`);
        }

        SingletonBase._instanceMap.set(ctor, this);
        this.onSingletonInit?.();
    }

    /**
     * 可选钩子：单例首次初始化完成时调用。
     */
    protected onSingletonInit?(): void;

    /**
     * 可选钩子：调用 destroy() 注销单例时调用。
     */
    protected onSingletonDestroy?(): void;
}
