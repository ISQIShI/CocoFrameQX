import type { ServiceLocator } from './ServiceLocator';

/**
 * 构造函数类型定义
 */
export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * 抽象类构造函数类型定义
 */
export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T;

/**
 * 服务工厂函数定义
 */
export type ServiceFactory<T = any> = (locator: ServiceLocator) => T;

/**
 * 类型化服务标识符（专为 TypeScript 接口设计）
 * 解决 TS 接口在运行时无法作为值使用的痛点。
 */
export interface ServiceToken<T> {
    readonly description: string;
    /** 仅在编译期进行类型推导与校验，运行时为 undefined */
    readonly __type?: T;
}

/**
 * 创建用于接口绑定的类型化服务令牌（ServiceToken）
 * @example
 * ```ts
 * export interface IAudioService {
 *     playBGM(name: string): void;
 * }
 * export const IAudioService = createServiceToken<IAudioService>('IAudioService');
 * 
 * locator.registerSingleton(IAudioService, AudioService);
 * const audio = locator.get(IAudioService); // 自动推导为 IAudioService
 * ```
 */
export function createServiceToken<T>(description: string): ServiceToken<T> {
    return Object.freeze({
        description,
        toString() {
            return `ServiceToken(${description})`;
        }
    });
}

/**
 * 统一服务标识符：支持 类构造函数 / 抽象类 / ServiceToken / 字符串 / Symbol
 */
export type ServiceIdentifier<T = any> =
    | Constructor<T>
    | AbstractConstructor<T>
    | ServiceToken<T>
    | string
    | symbol;

/**
 * 服务生命周期模式
 */
export enum ServiceLifetime {
    /**
     * 单例模式（Singleton）：
     * 在整个容器（或作用域树）中全局唯一。首次获取时惰性创建并缓存，后续获取复用已有实例。
     */
    Singleton = 'Singleton',

    /**
     * 作用域单例模式（Scoped）：
     * 在当前 ServiceLocator / Scope 内部为单例。
     * 每个独立的子作用域（如特定关卡、场景、副本）拥有独立的实例，随作用域销毁而释放。
     */
    Scoped = 'Scoped',

    /**
     * 瞬态模式（Transient）：
     * 每次解析时都重新通过工厂或构造函数创建全新实例，容器不持久缓存该实例。
     */
    Transient = 'Transient',
}

/**
 * 服务生命周期感知接口
 * 服务类实现该接口后，容器在创建与销毁时将自动调用对应的钩子。
 */
export interface IServiceLifecycle {
    /**
     * 服务初始化钩子（在服务首次实例化后自动调用，支持同步或异步）
     * @param locator 解析该服务的定位器实例
     */
    onServiceInit?(locator: ServiceLocator): void | Promise<void>;

    /**
     * 服务销毁钩子（在定位器 dispose 或 unregister 时自动调用，遵循 LIFO 逆序销毁）
     */
    onServiceDispose?(): void | Promise<void>;
}

/**
 * 服务基础接口，建议服务类实现该接口或继承该规范
 */
export interface IService extends IServiceLifecycle {
    /** 备选生命周期方法名，兼容常规命名习惯 */
    init?(locator: ServiceLocator): void | Promise<void>;
    /** 备选生命周期方法名，兼容常规命名习惯 */
    dispose?(): void | Promise<void>;
}

/**
 * 服务注册通用选项
 */
export interface ServiceRegistrationOptions<T = any> {
    /** 服务生命周期（默认为 Singleton） */
    lifetime?: ServiceLifetime;
    /** 是否立即实例化（仅对 Singleton 生效，默认为 false 懒加载） */
    eager?: boolean;
    /** 是否允许覆盖已存在的绑定（默认为 true） */
    allowOverride?: boolean;
    /** 自定义销毁回调（优先于实例自带的 onServiceDispose/dispose） */
    onDispose?: (instance: T) => void | Promise<void>;
}

/**
 * 实例有效性校验器类型
 * 可由外部引擎扩展（如 Cocos isValid 判定）传入，解耦定位器核心与具体运行时环境。
 */
export type InstanceValidator = (instance: any, token: ServiceIdentifier) => boolean;

/**
 * 内部绑定项定义
 */
export interface ServiceBinding<T = any> {
    token: ServiceIdentifier<T>;
    lifetime: ServiceLifetime;
    factory: ServiceFactory<T>;
    /** 是否是直接注册的外部实例常量 */
    isConstant: boolean;
    /** 自定义销毁回调 */
    onDispose?: (instance: T) => void | Promise<void>;
    /** 扩展元数据标记 */
    tag?: string;
}

/**
 * 内部实例化记录（用于逆序安全销毁与异步等待）
 */
export interface InstantiatedRecord<T = any> {
    token: ServiceIdentifier<T>;
    instance: T;
    binding: ServiceBinding<T>;
    initPromise?: Promise<void>;
}
