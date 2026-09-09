import { _decorator, Component, director, Enum, isValid, Node } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 单例跨场景常驻模式枚举
 */
export enum PersistMode {
    /** 未配置：遵循类静态成员 autoPersist 的设置 */
    Unset = 0,
    /** True：强制跨场景常驻（覆盖类静态配置） */
    True = 1,
    /** False：强制不跨场景常驻（覆盖类静态配置） */
    False = 2,
}
Enum(PersistMode);

@ccclass('ComponentSingletonBase')
export abstract class ComponentSingletonBase extends Component {

    /**
     * 类配置：是否在调用 getInstance() 发现实例缺失时自动创建。
     * 子类如需启用，声明：`public static override autoCreate = true;`
     */
    public static autoCreate: boolean = false;

    /**
     * 类配置：是否跨场景常驻（加入常驻根节点）。
     * 子类如需启用，声明：`public static override autoPersist = true;`
     * 实例上的 autoPersist 为 Unset（未配置）时，以此静态属性为准。
     */
    public static autoPersist: boolean = false;

    /**
     * 实例配置：是否跨场景常驻。
     * - Unset（未配置）：默认值，遵循类静态成员 autoPersist 的配置
     * - True：覆盖静态配置，强制常驻
     * - False：覆盖静态配置，强制非常驻
     */
    @property({
        type: Enum(PersistMode),
        tooltip: '跨场景常驻配置：Unset（未配置，沿用类静态配置）、True（覆盖为强制常驻）、False（覆盖为强制非常驻）'
    })
    protected autoPersist: PersistMode = PersistMode.Unset;

    /**
     * 遇到重复单例冲突时是否销毁整个 Node。
     * 默认为 false（只销毁重复的 Component，防止误删同节点挂载的其他组件或子节点）
     */
    @property({ tooltip: '单例冲突时是否销毁整个 Node，false 则仅销毁当前组件' })
    protected destroyNodeOnConflict: boolean = false;

    // 存储各个具体派生类的单例实例，按构造函数隔离
    private static readonly _instanceMap: Map<Function, ComponentSingletonBase> = new Map();

    /**
     * 获取单例实例
     * - 利用 TS 静态方法的 this 构造函数类型推导，SubClass.getInstance() 自动推导为 SubClass
     * - 若实例缺失且当前类配置了 `autoCreate = true`，则自动创建并挂载到场景中
     */
    public static getInstance<T extends ComponentSingletonBase>(this: new (...args: any[]) => T): T {
        const ctor = this as unknown as typeof ComponentSingletonBase;
        const instance = ComponentSingletonBase._instanceMap.get(this);
        if (instance && isValid(instance)) {
            return instance as T;
        }

        // 懒加载：配置 autoCreate 为 true 时缺失自动创建
        if (ctor.autoCreate) {
            return ComponentSingletonBase._createInstance(this);
        }

        return null as unknown as T;
    }

    /**
     * 判断单例实例是否存在且有效
     */
    public static hasInstance<T extends ComponentSingletonBase>(this: new (...args: any[]) => T): boolean {
        const instance = ComponentSingletonBase._instanceMap.get(this);
        return instance !== undefined && instance !== null && isValid(instance);
    }

    /**
     * 强制获取或自动创建单例实例（忽略 autoCreate 配置开关）
     */
    public static getOrCreateInstance<T extends ComponentSingletonBase>(this: new (...args: any[]) => T): T {
        const instance = ComponentSingletonBase._instanceMap.get(this);
        if (instance && isValid(instance)) {
            return instance as T;
        }
        return ComponentSingletonBase._createInstance(this);
    }

    /**
     * 内部创建单例节点与组件
     */
    protected static _createInstance<T extends ComponentSingletonBase>(ctor: new (...args: any[]) => T): T {
        // 二次防御，防止并发调用重复创建
        const existing = ComponentSingletonBase._instanceMap.get(ctor);
        if (existing && isValid(existing)) {
            return existing as T;
        }

        const scene = director.getScene();
        if (!scene) {
            console.error(`[ComponentSingletonBase] 自动创建 ${ctor.name} 失败：未处于运行场景中`);
            return null as unknown as T;
        }

        const nodeName = `__${ctor.name}__`;
        let node = scene.getChildByName(nodeName);
        if (!node) {
            node = new Node(nodeName);
            scene.addChild(node);
        }

        // addComponent 会同步触发构造函数与 __preload 注册
        const comp = node.addComponent(ctor as any) as unknown as T;
        return comp;
    }

    constructor() {
        super();
        this._hookLifecycle();
    }

    /**
     * 自动包装生命周期，子类无需显式调用 super.onLoad() / super.onDestroy()
     */
    private _hookLifecycle() {
        const ctor = this.constructor as typeof ComponentSingletonBase;

        // 1. 劫持 __preload：提前至所有组件 onLoad 之前完成单例注册，避免时序竞态
        const origPreload = (this as any).__preload;
        (this as any).__preload = () => {
            const isSuccess = this._registerSingleton(ctor);
            if (!isSuccess) {
                return;
            }
            if (origPreload) {
                origPreload.call(this);
            }
        };

        // 2. 劫持 onLoad：做注册兜底（以防 __preload 未被触发），并保证原生 onLoad 正常调用
        const origOnLoad = this.onLoad;
        this.onLoad = () => {
            if (!this._isRegistered(ctor)) {
                const isSuccess = this._registerSingleton(ctor);
                if (!isSuccess) {
                    return;
                }
            }
            if (origOnLoad) {
                origOnLoad.call(this);
            }
        };

        // 3. 劫持 onDestroy：自动解绑并重置单例引用与常驻节点
        const origOnDestroy = this.onDestroy;
        this.onDestroy = () => {
            try {
                if (origOnDestroy) {
                    origOnDestroy.call(this);
                }
            } finally {
                this._unregisterSingleton(ctor);
            }
        };
    }

    /**
     * 检查当前单例是否已注册
     */
    private _isRegistered(ctor: typeof ComponentSingletonBase): boolean {
        return ComponentSingletonBase._instanceMap.get(ctor) === this;
    }

    /**
     * 注册单例并处理常驻与冲突检测
     */
    private _registerSingleton(ctor: typeof ComponentSingletonBase): boolean {
        const currentInstance = ComponentSingletonBase._instanceMap.get(ctor);
        if (!currentInstance || !isValid(currentInstance)) {
            ComponentSingletonBase._instanceMap.set(ctor, this);
            this._applyPersist(ctor);
            this.onSingletonInit?.();
            return true;
        }

        if (currentInstance !== this) {
            console.warn(`[ComponentSingletonBase] 已经存在 ${ctor.name} 类型的有效实例，新实例已自动销毁`);
            if (this.destroyNodeOnConflict) {
                this.node.destroy();
            } else {
                this.destroy();
            }
            return false;
        }

        return true;
    }

    /**
     * 注销单例
     */
    private _unregisterSingleton(ctor: typeof ComponentSingletonBase) {
        if (ComponentSingletonBase._instanceMap.get(ctor) === this) {
            ComponentSingletonBase._instanceMap.delete(ctor);
            this.onSingletonDestroy?.();

            // 若当前节点是常驻根节点，安全移除
            if (isValid(this.node) && director.isPersistRootNode(this.node)) {
                director.removePersistRootNode(this.node);
            }
        }
    }

    /**
     * 判断当前单例是否应当跨场景常驻
     * 优先级：实例 autoPersist（True/False） > 类静态成员 autoPersist
     */
    private _shouldPersist(ctor: typeof ComponentSingletonBase): boolean {
        if (this.autoPersist === PersistMode.True) {
            return true;
        }
        if (this.autoPersist === PersistMode.False) {
            return false;
        }
        // 未配置 (PersistMode.Unset)，则以类静态成员 autoPersist 为准
        return !!ctor.autoPersist;
    }

    /**
     * 应用跨场景常驻逻辑
     */
    private _applyPersist(ctor: typeof ComponentSingletonBase) {
        if (!this._shouldPersist(ctor)) return;

        const scene = director.getScene();
        if (!scene) {
            console.warn(`[ComponentSingletonBase] 无法获取当前场景，无法将 ${ctor.name} 设为常驻节点`);
            return;
        }

        if (director.isPersistRootNode(this.node)) {
            return;
        }

        // Cocos Creator 要求常驻节点必须为场景根节点
        if (this.node.parent !== scene) {
            this.node.removeFromParent();
            scene.addChild(this.node);
        }

        director.addPersistRootNode(this.node);
    }

    /**
     * 可选生命周期钩子：单例首次初始化完成（且未冲突）时调用
     */
    protected onSingletonInit?(): void;

    /**
     * 可选生命周期钩子：单例解绑销毁时调用
     */
    protected onSingletonDestroy?(): void;
}
