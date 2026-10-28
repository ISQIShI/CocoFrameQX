import { Component, director, isValid, Node } from 'cc';
import { ServiceLocator } from './ServiceLocator';
import { ServiceLifetime, ServiceToken } from './ServiceTypes';

/** 仅借用编辑器或其他系统提供的组件；作用域释放不会销毁它或其节点。 */
export function registerComponentInstance<T extends Component>(scope: ServiceLocator, token: ServiceToken<T>, component: T): ServiceLocator {
    return scope.registerValue(token, component, { isValid: value => isValid(value, true) });
}
export interface ComponentServiceOptions {
    lifetime?: ServiceLifetime;
    /** 必须明确给出父节点；不猜当前场景或复用同名用户节点。 */
    parent: Node;
    nodeName?: string;
    persist?: boolean;
}
/** 每个工厂实例独占新节点。释放只销毁自己创建的节点，不操作外部父节点。 */
export function registerComponentFactory<T extends Component>(scope: ServiceLocator, token: ServiceToken<T>,
    ctor: new (...args: any[]) => T, options: ComponentServiceOptions): ServiceLocator {
    const { parent, persist = false, nodeName = token.description, lifetime = 'singleton' } = options;
    const ownedNodes = new WeakMap<T, Node>();
    return scope.registerFactory(token, () => {
        if (!isValid(parent, true)) throw new Error('组件服务父节点已失效');
        if (persist && parent !== director.getScene()) throw new Error('常驻组件服务的父节点必须是当前场景');
        const node = new Node(nodeName);
        try {
            parent.addChild(node);
            const component = node.addComponent(ctor);
            if (!component || !isValid(component, true)) throw new Error('无法创建组件服务：' + token.description);
            if (persist) director.addPersistRootNode(node);
            ownedNodes.set(component, node);
            return component;
        } catch (error) {
            if (director.isPersistRootNode(node)) director.removePersistRootNode(node);
            node.destroy(); throw error;
        }
    }, { lifetime, isValid: value => isValid(value, true), dispose: component => {
        const node = ownedNodes.get(component);
        if (!node) return;
        ownedNodes.delete(component);
        if (director.isPersistRootNode(node)) director.removePersistRootNode(node);
        if (isValid(node, true)) node.destroy();
    } });
}
