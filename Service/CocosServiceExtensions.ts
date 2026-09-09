import { Component, Node, director, isValid } from 'cc';
import { ServiceLocator } from './ServiceLocator';
import {
    Constructor,
    ServiceFactory,
    ServiceIdentifier,
    ServiceLifetime,
    ServiceBinding
} from './ServiceTypes';

/**
 * Cocos Component 服务扩展选项
 */
export interface ComponentServiceOptions {
    /** 挂载的节点名称，默认根据类名或 Token 生成 `__${name}__` */
    nodeName?: string;
    /** 挂载的父节点，默认为当前场景根节点 */
    parentNode?: Node;
    /** 是否跨场景常驻（内部调用 director.addPersistRootNode） */
    persist?: boolean;
    /** 是否允许覆盖已存在的绑定（默认为 true） */
    allowOverride?: boolean;
}

/**
 * 校验对象是否为有效存活的 Cocos 节点/组件
 */
export function isCocosValid(obj: any): boolean {
    if (obj === null || obj === undefined) return false;
    if (typeof isValid === 'function') {
        try {
            return isValid(obj);
        } catch {
            return true;
        }
    }
    return true;
}

/**
 * 为服务定位器启用 Cocos 对象有效性校验扩展
 * 注册后，定位器在解析实例时将自动检测组件/节点是否已被引擎 `destroy`，若是则自动清除死引用。
 * @param locator 目标服务定位器
 */
export function enableCocosValidation(locator: ServiceLocator): ServiceLocator {
    locator.setValidator((instance) => isCocosValid(instance));
    return locator;
}

/**
 * 创建 Cocos Component 惰性挂载工厂函数
 * @param ctor 组件类构造函数
 * @param options 组件服务配置项
 */
export function createComponentFactory<T extends Component>(
    ctor: Constructor<T>,
    options?: ComponentServiceOptions
): ServiceFactory<T> {
    return (_locator) => {
        const scene = director.getScene();
        if (!scene && !options?.parentNode) {
            console.warn(`[CocosServiceExtensions] 当前尚未加载任何场景，尝试在未初始化的上下文中挂载组件: ${ctor.name}`);
        }

        const targetParent = options?.parentNode || scene;
        const nodeName = options?.nodeName || `__${ctor.name}__`;

        let targetNode = targetParent ? targetParent.getChildByName(nodeName) : null;
        if (!targetNode) {
            targetNode = new Node(nodeName);
            if (targetParent) {
                targetParent.addChild(targetNode);
            }
        }

        // 处理跨场景常驻
        if (options?.persist) {
            if (scene && targetNode.parent !== scene) {
                targetNode.removeFromParent();
                scene.addChild(targetNode);
            }
            if (!director.isPersistRootNode(targetNode)) {
                director.addPersistRootNode(targetNode);
            }
        }

        let comp = targetNode.getComponent(ctor);
        if (!comp) {
            comp = targetNode.addComponent(ctor);
        }

        return comp;
    };
}

/**
 * 为定位器注册 Cocos Component 服务（扩展函数）
 * 
 * 优势特性：
 * 1. 自动为 locator 安装 Cocos isValid 失效感知校验器。
 * 2. 支持传入已有组件实例或组件类（按需自动建节点挂载）。
 * 3. 支持一键设置跨场景常驻节点。
 * 4. 定位器销毁时自动协同清理节点与常驻标记。
 * 
 * @param locator 目标定位器
 * @param token 服务标识符
 * @param componentCtorOrInstance 组件构造函数或已有组件实例
 * @param options 扩展配置
 */
export function registerComponent<T extends Component>(
    locator: ServiceLocator,
    token: ServiceIdentifier<T>,
    componentCtorOrInstance: Constructor<T> | T,
    options?: ComponentServiceOptions
): ServiceLocator {
    // 确保已挂载 Cocos 有效性检查
    if (!locator.getValidator()) {
        enableCocosValidation(locator);
    }

    // 场景 A: 传入的是已经挂载的 Component 实例
    if (typeof componentCtorOrInstance !== 'function') {
        const instance = componentCtorOrInstance;
        const binding: ServiceBinding<T> = {
            token,
            lifetime: ServiceLifetime.Singleton,
            factory: () => instance,
            isConstant: true,
            tag: 'CocosComponent',
            onDispose: (comp) => {
                if (isCocosValid(comp)) {
                    comp.destroy();
                }
            }
        };
        locator._internalRegister(binding, options?.allowOverride);
        locator._setInstanceDirectly(token, instance, binding.onDispose);
        return locator;
    }

    // 场景 B: 传入的是 Component 类构造函数
    const ctor = componentCtorOrInstance as Constructor<T>;
    const factory = createComponentFactory(ctor, options);

    const binding: ServiceBinding<T> = {
        token,
        lifetime: ServiceLifetime.Singleton,
        factory,
        isConstant: false,
        tag: 'CocosComponent',
        onDispose: (comp) => {
            if (isCocosValid(comp)) {
                const node = comp.node;
                comp.destroy();
                if (options?.persist && isCocosValid(node) && director.isPersistRootNode(node)) {
                    director.removePersistRootNode(node);
                }
            }
        }
    };

    locator._internalRegister(binding, options?.allowOverride);
    return locator;
}
