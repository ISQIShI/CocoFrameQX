import type { ServiceLocator } from './ServiceLocator';
import {
    Constructor,
    ServiceFactory,
    ServiceIdentifier,
    ServiceLifetime
} from './ServiceTypes';

/**
 * 链式绑定的作用域/生命周期配置器接口
 */
export interface IBindingScope<T> {
    /** 标记为单例（默认） */
    asSingleton(): ServiceLocator;
    /** 标记为作用域单例 */
    asScoped(): ServiceLocator;
    /** 标记为瞬态（每次获取都创建新实例） */
    asTransient(): ServiceLocator;
    /** 声明为立即实例化（单例有效） */
    eager(): ServiceLocator;
    /** 配置自定义销毁钩子 */
    onDispose(callback: (instance: T) => void | Promise<void>): IBindingScope<T>;
}

/**
 * 链式绑定的目标配置器接口
 */
export interface IBindingTo<T> {
    /** 绑定至具体的实现类构造函数 */
    to<TImpl extends T>(implementation: Constructor<TImpl>): IBindingScope<T>;
    /** 绑定至自定义工厂方法 */
    toFactory<TImpl extends T>(factory: ServiceFactory<TImpl>): IBindingScope<T>;
    /** 直接绑定至已有实例（等同于 toInstance） */
    toValue(instance: T): ServiceLocator;
    /** 直接绑定至已有实例 */
    toInstance(instance: T): ServiceLocator;
}

/**
 * 链式绑定构造器实现
 */
export class BindingBuilder<T> implements IBindingTo<T>, IBindingScope<T> {
    private readonly _locator: ServiceLocator;
    private readonly _token: ServiceIdentifier<T>;
    private _factory: ServiceFactory<T> | null = null;
    private _lifetime: ServiceLifetime = ServiceLifetime.Singleton;
    private _isConstant: boolean = false;
    private _onDispose?: (instance: T) => void | Promise<void>;
    private _isEager: boolean = false;

    public constructor(locator: ServiceLocator, token: ServiceIdentifier<T>) {
        this._locator = locator;
        this._token = token;
    }

    public to<TImpl extends T>(implementation: Constructor<TImpl>): IBindingScope<T> {
        this._factory = (_loc) => new implementation();
        this._commit();
        return this;
    }

    public toFactory<TImpl extends T>(factory: ServiceFactory<TImpl>): IBindingScope<T> {
        this._factory = factory;
        this._commit();
        return this;
    }

    public toValue(instance: T): ServiceLocator {
        return this.toInstance(instance);
    }

    public toInstance(instance: T): ServiceLocator {
        this._factory = () => instance;
        this._lifetime = ServiceLifetime.Singleton;
        this._isConstant = true;
        this._commit();
        this._locator._setInstanceDirectly(this._token, instance, this._onDispose);
        return this._locator;
    }

    public asSingleton(): ServiceLocator {
        this._lifetime = ServiceLifetime.Singleton;
        this._commit();
        return this._locator;
    }

    public asScoped(): ServiceLocator {
        this._lifetime = ServiceLifetime.Scoped;
        this._commit();
        return this._locator;
    }

    public asTransient(): ServiceLocator {
        this._lifetime = ServiceLifetime.Transient;
        this._commit();
        return this._locator;
    }

    public eager(): ServiceLocator {
        this._isEager = true;
        this._commit();
        if (this._lifetime === ServiceLifetime.Singleton) {
            this._locator.get(this._token);
        }
        return this._locator;
    }

    public onDispose(callback: (instance: T) => void | Promise<void>): IBindingScope<T> {
        this._onDispose = callback;
        this._commit();
        return this;
    }

    private _commit(): void {
        if (!this._factory) return;
        this._locator._internalRegister({
            token: this._token,
            lifetime: this._lifetime,
            factory: this._factory,
            isConstant: this._isConstant,
            onDispose: this._onDispose
        });
        if (this._isEager && this._lifetime === ServiceLifetime.Singleton) {
            this._locator.get(this._token);
        }
    }
}
