/**
 * CocoFrameQX - CocosExtension
 * Cocos Creator 引擎专属扩展适配器与组件装饰器系统
 * 
 * 本模块与 EventCenter 本体完全解耦，将所有 Cocos 引擎特有的生命周期、
 * 对象有效性感知（isValid）与组件装饰器集中于此作为外挂扩展提供。
 */

import { isValid } from 'cc';
import {
    EventKey,
    EventListenerOptions,
    EventScopeKey,
    IEventCenter,
    AnyEventMap,
    EventCenterOptions
} from './EventTypes';
import { EventCenter } from './EventCenter';

// ==========================================
// 1. Cocos 对象生命周期感知验证器适配
// ==========================================

/**
 * Cocos 引擎对象有效性校验函数
 * 当 target 是 Cocos 节点或组件时，校验其是否已被 engine.destroy() 销毁
 */
export function cocosTargetValidator(target: any): boolean {
    if (target === null || target === undefined) return false;
    if (typeof isValid === 'function') {
        try {
            return isValid(target);
        } catch {
            return true;
        }
    }
    return true;
}

/**
 * 为指定的事件中心开启 Cocos 引擎对象生命周期感知防御
 * 自动拦截并过滤已被引擎销毁（isValid 为 false）的目标，杜绝野指针崩溃与死引用
 */
export function enableCocosSupport<T extends EventCenter<any>>(eventCenter: T): T {
    eventCenter.setTargetValidator(cocosTargetValidator);
    return eventCenter;
}

/**
 * 工厂函数：直接创建一个预设装载了 Cocos 有效性校验的事件中心实例
 */
export function createCocosEventCenter<TEventMap extends AnyEventMap = any>(
    options?: Omit<EventCenterOptions, 'targetValidator'> | string
): EventCenter<TEventMap> {
    const rawOptions: EventCenterOptions = typeof options === 'string'
        ? { name: options, targetValidator: cocosTargetValidator }
        : { ...options, targetValidator: cocosTargetValidator };
    return new EventCenter<TEventMap>(rawOptions);
}

// ==========================================
// 2. Cocos 组件声明式监听装饰器
// ==========================================

export type EventCenterProvider = IEventCenter | (() => IEventCenter);

let _defaultEventCenterProvider: EventCenterProvider | null = null;

/**
 * 配置 Cocos 装饰器默认使用的事件中心提供者（如用户自定义的全局单例、服务定位器容器等）
 * 
 * @example
 * ```ts
 * // 在游戏启动或初始化阶段配置：
 * setDefaultEventCenter(GameEventCenter.instance);
 * // 或动态函数获取：
 * setDefaultEventCenter(() => ServiceLocator.get(EventCenter));
 * ```
 */
export function setDefaultEventCenter(provider: EventCenterProvider | null): void {
    _defaultEventCenterProvider = provider;
}

/**
 * 获取当前装饰器系统绑定的默认事件中心
 */
export function getDefaultEventCenter(): IEventCenter {
    if (!_defaultEventCenterProvider) {
        throw new Error(
            '[CocosExtension] 尚未设置默认事件中心。请先调用 setDefaultEventCenter(myEventCenter) 进行配置，或在装饰器选项中指定 { center: myEventCenter }。'
        );
    }
    return typeof _defaultEventCenterProvider === 'function'
        ? _defaultEventCenterProvider()
        : _defaultEventCenterProvider;
}

export interface CocosDecoratorOptions extends EventListenerOptions {
    /**
     * 该监听器绑定的事件中心实例或获取函数。
     * 若未传，将自动回退使用通过 `setDefaultEventCenter()` 配置的默认中心。
     */
    center?: EventCenterProvider;

    /**
     * 生命周期绑定模式：
     * - 'enable' (默认)：在 onEnable 注册，在 onDisable 注销（适合绝大多数 UI 与游戏实体组件）
     * - 'load'：在 onLoad 注册，在 onDestroy 注销（适合常驻或即使失活也需要响应事件的组件）
     */
    lifecycle?: 'enable' | 'load';
}

interface DecoratorMetadataItem {
    propertyKey: string | symbol;
    eventID: EventKey;
    scope?: EventScopeKey;
    options: CocosDecoratorOptions;
}

const EVENT_METADATA_KEY = Symbol('__coco_event_metadata__');
const EVENT_PATCHED_FLAG = Symbol('__coco_event_patched__');

function _resolveCenter(provider?: EventCenterProvider): IEventCenter {
    if (provider) {
        return typeof provider === 'function' ? provider() : provider;
    }
    return getDefaultEventCenter();
}

/**
 * 装饰 Cocos Component 成员方法以自动监听事件
 * 
 * @example
 * ```ts
 * @ccclass('PlayerView')
 * export class PlayerView extends Component {
 *     @listenEvent(GameEvent.PlayerSpawn)
 *     private onPlayerSpawn(data: PlayerData) {
 *         console.log('Player spawn:', data);
 *     }
 * 
 *     // 支持显式指定独立的事件中心实例
 *     @listenEvent('LOCAL_EVENT', { center: myLocalCenter })
 *     private onLocalEvent() {}
 * }
 * ```
 */
export function listenEvent(eventID: EventKey, options?: CocosDecoratorOptions): any;
export function listenEvent(scope: EventScopeKey, eventID: EventKey, options?: CocosDecoratorOptions): any;
export function listenEvent(...args: any[]): any {
    let scope: EventScopeKey | undefined;
    let eventID: EventKey;
    let options: CocosDecoratorOptions | undefined;

    if (args.length >= 2 && (typeof args[0] === 'object' || typeof args[0] === 'function')) {
        scope = args[0];
        eventID = args[1];
        options = args[2];
    } else {
        eventID = args[0];
        options = args[1];
        scope = options?.scope;
    }

    const finalOptions: CocosDecoratorOptions = {
        lifecycle: 'enable',
        ...options,
        scope
    };

    return function (...decoratorArgs: any[]) {
        if (
            decoratorArgs.length === 2 &&
            decoratorArgs[1] &&
            typeof decoratorArgs[1] === 'object' &&
            'kind' in decoratorArgs[1]
        ) {
            // TC39 Stage 3 标准装饰器
            const context = decoratorArgs[1];
            const propertyKey = context.name;
            if (typeof context.addInitializer === 'function') {
                context.addInitializer(function (this: any) {
                    const proto = Object.getPrototypeOf(this);
                    _registerDecoratorMetadata(proto, propertyKey, eventID, scope, finalOptions);
                    _bindInstanceLifecycle(this, proto);
                });
            }
        } else {
            // TypeScript Legacy (experimentalDecorators) 标准（Cocos 引擎标准）
            const target = decoratorArgs[0];
            const propertyKey = decoratorArgs[1];
            _registerDecoratorMetadata(target, propertyKey, eventID, scope, finalOptions);
        }
    };
}

/**
 * 装饰 Cocos Component 成员方法以自动监听单次事件
 */
export function listenEventOnce(eventID: EventKey, options?: CocosDecoratorOptions): any;
export function listenEventOnce(scope: EventScopeKey, eventID: EventKey, options?: CocosDecoratorOptions): any;
export function listenEventOnce(...args: any[]): any {
    let scope: EventScopeKey | undefined;
    let eventID: EventKey;
    let options: CocosDecoratorOptions | undefined;

    if (args.length >= 2 && (typeof args[0] === 'object' || typeof args[0] === 'function')) {
        scope = args[0];
        eventID = args[1];
        options = args[2];
    } else {
        eventID = args[0];
        options = args[1];
        scope = options?.scope;
    }

    const finalOptions: CocosDecoratorOptions = {
        lifecycle: 'enable',
        ...options,
        once: true,
        scope
    };

    return function (...decoratorArgs: any[]) {
        if (
            decoratorArgs.length === 2 &&
            decoratorArgs[1] &&
            typeof decoratorArgs[1] === 'object' &&
            'kind' in decoratorArgs[1]
        ) {
            const context = decoratorArgs[1];
            const propertyKey = context.name;
            if (typeof context.addInitializer === 'function') {
                context.addInitializer(function (this: any) {
                    const proto = Object.getPrototypeOf(this);
                    _registerDecoratorMetadata(proto, propertyKey, eventID, scope, finalOptions);
                    _bindInstanceLifecycle(this, proto);
                });
            }
        } else {
            const target = decoratorArgs[0];
            const propertyKey = decoratorArgs[1];
            _registerDecoratorMetadata(target, propertyKey, eventID, scope, finalOptions);
        }
    };
}

/**
 * 辅助工厂：为特定的事件中心快速创建专属装饰器套件
 */
export function createEventDecorator(centerProvider: EventCenterProvider) {
    return {
        listenEvent: (eventID: EventKey, options?: CocosDecoratorOptions) =>
            listenEvent(eventID, { center: centerProvider, ...options }),
        listenEventOnce: (eventID: EventKey, options?: CocosDecoratorOptions) =>
            listenEventOnce(eventID, { center: centerProvider, ...options })
    };
}

function _registerDecoratorMetadata(
    proto: any,
    propertyKey: string | symbol,
    eventID: EventKey,
    scope: EventScopeKey | undefined,
    options: CocosDecoratorOptions
): void {
    if (!proto) return;

    if (!Object.prototype.hasOwnProperty.call(proto, EVENT_METADATA_KEY)) {
        proto[EVENT_METADATA_KEY] = [];
    }
    const list: DecoratorMetadataItem[] = proto[EVENT_METADATA_KEY];
    const existing = list.find(item => item.propertyKey === propertyKey && item.eventID === eventID);
    if (!existing) {
        list.push({ propertyKey, eventID, scope, options });
    }

    _patchComponentLifecycle(proto);
}

function _registerLifecycleEvents(target: any, proto: any, lifecycle: 'load' | 'enable'): void {
    const metadataList: DecoratorMetadataItem[] = proto[EVENT_METADATA_KEY] || [];
    for (const item of metadataList) {
        if (
            (lifecycle === 'load' && item.options.lifecycle === 'load') ||
            (lifecycle === 'enable' && item.options.lifecycle !== 'load')
        ) {
            const method = target[item.propertyKey];
            if (typeof method === 'function') {
                const center = _resolveCenter(item.options.center);
                if (item.scope !== undefined) {
                    center.addListener(item.scope, item.eventID, method, target, item.options);
                } else {
                    center.addListener(item.eventID, method, target, item.options);
                }
            }
        }
    }
}

function _unregisterLifecycleEvents(target: any, proto: any, lifecycle: 'load' | 'enable'): void {
    const metadataList: DecoratorMetadataItem[] = proto[EVENT_METADATA_KEY] || [];
    for (const item of metadataList) {
        if (
            (lifecycle === 'load' && item.options.lifecycle === 'load') ||
            (lifecycle === 'enable' && item.options.lifecycle !== 'load')
        ) {
            const method = target[item.propertyKey];
            if (typeof method === 'function') {
                try {
                    const center = _resolveCenter(item.options.center);
                    if (item.scope !== undefined) {
                        center.removeListener(item.scope, item.eventID, method, target);
                    } else {
                        center.removeListener(item.eventID, method, target);
                    }
                } catch {
                    // 若 center 无法解析则安全略过
                }
            }
        }
    }
}

function _patchComponentLifecycle(proto: any): void {
    if (!proto || Object.prototype.hasOwnProperty.call(proto, EVENT_PATCHED_FLAG)) {
        return;
    }
    proto[EVENT_PATCHED_FLAG] = true;

    // 1. 劫持 onLoad
    const origOnLoad = proto.onLoad;
    proto.onLoad = function (this: any) {
        origOnLoad?.apply(this, arguments);
        _registerLifecycleEvents(this, proto, 'load');
    };

    // 2. 劫持 onEnable
    const origOnEnable = proto.onEnable;
    proto.onEnable = function (this: any) {
        origOnEnable?.apply(this, arguments);
        _registerLifecycleEvents(this, proto, 'enable');
    };

    // 3. 劫持 onDisable
    const origOnDisable = proto.onDisable;
    proto.onDisable = function (this: any) {
        origOnDisable?.apply(this, arguments);
        _unregisterLifecycleEvents(this, proto, 'enable');
    };

    // 4. 劫持 onDestroy 作为兜底保障
    const origOnDestroy = proto.onDestroy;
    proto.onDestroy = function (this: any) {
        origOnDestroy?.apply(this, arguments);
        _unregisterLifecycleEvents(this, proto, 'load');

        const metadataList: DecoratorMetadataItem[] = proto[EVENT_METADATA_KEY] || [];
        const checkedCenters = new Set<IEventCenter>();
        for (const item of metadataList) {
            try {
                const center = _resolveCenter(item.options.center);
                if (!checkedCenters.has(center)) {
                    checkedCenters.add(center);
                    center.removeByTarget(this);
                }
            } catch {
                // 安全忽略
            }
        }
    };
}

function _bindInstanceLifecycle(instance: any, proto: any): void {
    _patchComponentLifecycle(proto);

    const origOnLoad = instance.onLoad;
    if (origOnLoad && !origOnLoad.__patched__) {
        instance.onLoad = function (this: any) {
            origOnLoad.apply(this, arguments);
            _registerLifecycleEvents(this, proto, 'load');
        };
        instance.onLoad.__patched__ = true;
    }

    const origOnEnable = instance.onEnable;
    if (origOnEnable && !origOnEnable.__patched__) {
        instance.onEnable = function (this: any) {
            origOnEnable.apply(this, arguments);
            _registerLifecycleEvents(this, proto, 'enable');
        };
        instance.onEnable.__patched__ = true;
    }

    const origOnDisable = instance.onDisable;
    if (origOnDisable && !origOnDisable.__patched__) {
        instance.onDisable = function (this: any) {
            origOnDisable.apply(this, arguments);
            _unregisterLifecycleEvents(this, proto, 'enable');
        };
        instance.onDisable.__patched__ = true;
    }

    const origOnDestroy = instance.onDestroy;
    if (origOnDestroy && !origOnDestroy.__patched__) {
        instance.onDestroy = function (this: any) {
            origOnDestroy.apply(this, arguments);
            _unregisterLifecycleEvents(this, proto, 'load');

            const metadataList: DecoratorMetadataItem[] = proto[EVENT_METADATA_KEY] || [];
            const checkedCenters = new Set<IEventCenter>();
            for (const item of metadataList) {
                try {
                    const center = _resolveCenter(item.options.center);
                    if (!checkedCenters.has(center)) {
                        checkedCenters.add(center);
                        center.removeByTarget(this);
                    }
                } catch {
                    // 安全忽略
                }
            }
        };
        instance.onDestroy.__patched__ = true;
    }
}
