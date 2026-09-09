import {
    Constructor,
    AbstractConstructor,
    ServiceFactory,
    ServiceToken,
    ServiceIdentifier,
    ServiceLifetime,
    ServiceRegistrationOptions,
    ServiceBinding,
    InstantiatedRecord,
    InstanceValidator
} from './ServiceTypes';
import {
    IBindingTo,
    BindingBuilder
} from './BindingBuilder';

// 统一重导出所有类型和构造器
export * from './ServiceTypes';
export * from './BindingBuilder';

/**
 * 完善、好用的服务定位器（Service Locator）
 * 
 * 核心定位：
 * 1. 实例化的服务定位容器（去除了自动反射依赖注入的轻量级 IoC 容器）。
 * 2. 纯粹的 TypeScript 实现，本体无引擎强耦合依赖，可通过扩展模块适配不同环境。
 * 3. 强类型推导：支持 Class、Abstract Class、ServiceToken<T> 及 String/Symbol。
 * 4. 三大生命周期管理：单例（Singleton）、作用域（Scoped）、瞬态（Transient）。
 * 5. 树形层级作用域（Hierarchical Scopes）：支持作用域继承、作用域局部覆盖与 LIFO 逆序销毁。
 * 6. 循环依赖安全检测：在存在 A -> B -> A 等循环解析时直接抛出清晰调用链异常。
 * 7. 优雅的生命周期钩子：自动感知 `onServiceInit` / `init`（支持异步）与 `onServiceDispose` / `dispose`。
 * 8. 调试诊断支持：提供 `dump()` 打印层级依赖树与状态。
 */
export class ServiceLocator {
    private static _idCounter: number = 0;

    /** 定位器唯一 ID */
    public readonly id: number = ++ServiceLocator._idCounter;

    /** 定位器名称（便于调试和树状图打印） */
    public readonly name: string;

    /** 父级定位器（null 表示为根定位器） */
    public readonly parent: ServiceLocator | null = null;

    /** 是否已被销毁 */
    private _isDisposed: boolean = false;
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /** 实例有效性校验器（可由外部扩展设置，例如校验 Cocos 引擎对象生命周期） */
    private _validator: InstanceValidator | null = null;

    /** 注册项字典 */
    private readonly _bindings: Map<ServiceIdentifier, ServiceBinding> = new Map();

    /** 实例缓存字典（针对 Singleton 与 Scoped） */
    private readonly _instances: Map<ServiceIdentifier, any> = new Map();

    /** 实例创建记录（按创建时间先后顺序存入，用于 LIFO 逆序销毁与异步就绪管理） */
    private readonly _instantiatedRecords: InstantiatedRecord[] = [];

    /** 子作用域集合 */
    private readonly _childScopes: Set<ServiceLocator> = new Set();

    /** 循环依赖追踪调用栈（仅根容器统一维护一份） */
    private readonly _resolutionStack: ServiceIdentifier[] = [];

    public constructor(name?: string, parent: ServiceLocator | null = null, validator?: InstanceValidator | null) {
        this.name = name || (parent ? `Scope_${this.id}` : 'RootLocator');
        this.parent = parent;
        this._validator = validator !== undefined ? validator : (parent ? parent._validator : null);
        if (parent) {
            parent._childScopes.add(this);
        }
    }

    /**
     * 获取根定位器
     */
    private get _root(): ServiceLocator {
        return this.parent ? this.parent._root : this;
    }

    /**
     * 设置实例有效性校验器（例如 Cocos isValid 判定）
     */
    public setValidator(validator: InstanceValidator | null): this {
        this._validator = validator;
        return this;
    }

    /**
     * 获取当前定位器的实例有效性校验器
     */
    public getValidator(): InstanceValidator | null {
        return this._validator;
    }

    // ==========================================
    // 注册 API（Fluent 链式与 Direct 快捷）
    // ==========================================

    /**
     * 开启链式注册
     * @example
     * ```ts
     * locator.bind(IAudioService).to(AudioService).asSingleton();
     * locator.bind(IBattleService).toFactory(c => new BattleService(c.get(IAudioService))).asTransient();
     * ```
     */
    public bind<T>(token: ServiceIdentifier<T>): IBindingTo<T> {
        this._assertNotDisposed();
        return new BindingBuilder<T>(this, token);
    }

    /**
     * 注册已有的静态具体实例（单例模式）
     */
    public registerInstance<T>(
        token: ServiceIdentifier<T>,
        instance: T,
        options?: ServiceRegistrationOptions<T>
    ): this {
        this._assertNotDisposed();
        const binding: ServiceBinding<T> = {
            token,
            lifetime: ServiceLifetime.Singleton,
            factory: () => instance,
            isConstant: true,
            onDispose: options?.onDispose
        };

        this._internalRegister(binding, options?.allowOverride);
        this._setInstanceDirectly(token, instance, options?.onDispose);
        return this;
    }

    /**
     * 注册单例服务（全局/容器层级唯一，延迟创建或立即创建）
     */
    public registerSingleton<T>(
        token: ServiceIdentifier<T>,
        implementationOrFactory: Constructor<T> | ServiceFactory<T>,
        options?: ServiceRegistrationOptions<T>
    ): this {
        return this._registerByLifetime(token, implementationOrFactory, ServiceLifetime.Singleton, options);
    }

    /**
     * 注册作用域单例服务（在各个 Scope 内唯一）
     */
    public registerScoped<T>(
        token: ServiceIdentifier<T>,
        implementationOrFactory: Constructor<T> | ServiceFactory<T>,
        options?: ServiceRegistrationOptions<T>
    ): this {
        return this._registerByLifetime(token, implementationOrFactory, ServiceLifetime.Scoped, options);
    }

    /**
     * 注册瞬态服务（每次 get 均产生新实例）
     */
    public registerTransient<T>(
        token: ServiceIdentifier<T>,
        implementationOrFactory: Constructor<T> | ServiceFactory<T>,
        options?: ServiceRegistrationOptions<T>
    ): this {
        return this._registerByLifetime(token, implementationOrFactory, ServiceLifetime.Transient, options);
    }

    private _registerByLifetime<T>(
        token: ServiceIdentifier<T>,
        implementationOrFactory: Constructor<T> | ServiceFactory<T>,
        lifetime: ServiceLifetime,
        options?: ServiceRegistrationOptions<T>
    ): this {
        this._assertNotDisposed();

        const factory: ServiceFactory<T> = typeof implementationOrFactory === 'function' && implementationOrFactory.prototype
            ? () => new (implementationOrFactory as Constructor<T>)()
            : (implementationOrFactory as ServiceFactory<T>);

        const binding: ServiceBinding<T> = {
            token,
            lifetime,
            factory,
            isConstant: false,
            onDispose: options?.onDispose
        };

        this._internalRegister(binding, options?.allowOverride);

        if (options?.eager && lifetime === ServiceLifetime.Singleton) {
            this.get(token);
        }

        return this;
    }

    // ==========================================
    // 解析 API（Get / TryGet / GetAsync）
    // ==========================================

    /**
     * 解析并获取服务实例（若未找到将抛出错误）
     */
    public get<T>(token: Constructor<T> | AbstractConstructor<T>): T;
    public get<T>(token: ServiceToken<T>): T;
    public get<T = any>(token: ServiceIdentifier<T>): T;
    public get<T>(token: any): T {
        this._assertNotDisposed();
        const instance = this._resolve<T>(token, this);
        if (instance === undefined || instance === null) {
            throw new Error(`[ServiceLocator] 无法解析服务: [${ServiceLocator.getTokenName(token)}]，未找到有效注册项`);
        }
        return instance;
    }

    /**
     * 尝试解析服务实例（若未找到返回 undefined，不抛出异常）
     */
    public tryGet<T>(token: Constructor<T> | AbstractConstructor<T>): T | undefined;
    public tryGet<T>(token: ServiceToken<T>): T | undefined;
    public tryGet<T = any>(token: ServiceIdentifier<T>): T | undefined;
    public tryGet<T>(token: any): T | undefined {
        if (this._isDisposed) return undefined;
        try {
            return this._resolve<T>(token, this);
        } catch (error) {
            // 循环依赖等内部异常依然抛出，普通缺失则静默返回 undefined
            if (error instanceof Error && error.message.includes('循环依赖')) {
                throw error;
            }
            return undefined;
        }
    }

    /**
     * 异步解析并获取服务实例
     * 若该服务实现了异步 `onServiceInit` 或 `init`，将自动等待其 Promise 完成后返回。
     */
    public async getAsync<T>(token: Constructor<T> | AbstractConstructor<T>): Promise<T>;
    public async getAsync<T>(token: ServiceToken<T>): Promise<T>;
    public async getAsync<T = any>(token: ServiceIdentifier<T>): Promise<T>;
    public async getAsync<T>(token: any): Promise<T> {
        this._assertNotDisposed();
        const instance = this.get<T>(token);
        const record = this._instantiatedRecords.find(r => r.token === token);
        if (record && record.initPromise) {
            await record.initPromise;
        }
        return instance;
    }

    /**
     * 检查当前定位器树中是否存在某服务的注册
     * @param checkParent 是否向上查找父级容器（默认 true）
     */
    public has(token: ServiceIdentifier, checkParent: boolean = true): boolean {
        if (this._bindings.has(token) || this._instances.has(token)) {
            return true;
        }
        if (checkParent && this.parent) {
            return this.parent.has(token, true);
        }
        return false;
    }

    /**
     * 检查当前定位器是否直接包含某服务的注册项（不检查父级）
     */
    public isRegisteredLocally(token: ServiceIdentifier): boolean {
        return this._bindings.has(token);
    }

    /**
     * 检查某服务是否已经被实例化（缓存）
     */
    public isResolved(token: ServiceIdentifier): boolean {
        return this._instances.has(token);
    }

    // ==========================================
    // 作用域与生命周期管理
    // ==========================================

    /**
     * 创建子作用域（Child Scope / Hierarchical Container）
     * 场景/模块级别服务（如关卡、战斗副本、临时 UI）的最佳实践：
     * 子作用域可以继承父级所有注册与服务，同时可注册局部独立服务，并在退出时一键销毁所有局部服务。
     */
    public createScope(name?: string): ServiceLocator {
        this._assertNotDisposed();
        return new ServiceLocator(name, this, this._validator);
    }

    /**
     * 预热并初始化当前容器已注册的所有单例/作用域服务（支持异步等待）
     * 非常适用于游戏 Loading 界面，确保所有核心服务在进入场景前均准备就绪。
     */
    public async initAllAsync(): Promise<void> {
        this._assertNotDisposed();
        const promises: Promise<void>[] = [];

        for (const [token, binding] of this._bindings.entries()) {
            if (binding.lifetime === ServiceLifetime.Singleton || binding.lifetime === ServiceLifetime.Scoped) {
                this.get(token);
                const record = this._instantiatedRecords.find(r => r.token === token);
                if (record && record.initPromise) {
                    promises.push(record.initPromise);
                }
            }
        }

        await Promise.all(promises);
    }

    /**
     * 注销指定服务，并触发该服务的销毁钩子
     */
    public unregister(token: ServiceIdentifier): boolean {
        this._assertNotDisposed();
        let wasPresent = false;

        if (this._instances.has(token)) {
            const instance = this._instances.get(token);
            this._instances.delete(token);

            const recordIndex = this._instantiatedRecords.findIndex(r => r.token === token);
            if (recordIndex !== -1) {
                const record = this._instantiatedRecords.splice(recordIndex, 1)[0];
                this._disposeInstance(record.instance, record.binding);
            } else {
                this._disposeInstance(instance, this._bindings.get(token));
            }
            wasPresent = true;
        }

        if (this._bindings.has(token)) {
            this._bindings.delete(token);
            wasPresent = true;
        }

        return wasPresent;
    }

    /**
     * 清空当前容器中所有缓存的实例，但保留注册项（Bindings）
     */
    public clearInstances(): void {
        this._disposeAllInstances();
    }

    /**
     * 销毁当前定位器及其全部子作用域
     * 1. 递归优先销毁所有子作用域。
     * 2. 按照 LIFO（后创建先销毁）原则安全调用各服务销毁钩子。
     * 3. 解除与父级关联并清空内部集合。
     */
    public dispose(): void {
        if (this._isDisposed) return;
        this._isDisposed = true;

        // 1. 优先销毁所有子作用域
        for (const child of Array.from(this._childScopes)) {
            child.dispose();
        }
        this._childScopes.clear();

        // 2. 逆序销毁当前作用域已实例化的服务
        this._disposeAllInstances();

        // 3. 清空注册表
        this._bindings.clear();

        // 4. 从父容器中移除自身
        if (this.parent) {
            this.parent._childScopes.delete(this);
        }
    }

    // ==========================================
    // 内部实现与核心解析机制
    // ==========================================

    private _resolve<T>(token: ServiceIdentifier<T>, requestingScope: ServiceLocator): T | undefined {
        // 1. 检查当前定位器中是否已缓存了活跃实例
        if (this._instances.has(token)) {
            const cached = this._instances.get(token);
            if (this._isInstanceValid(cached, token)) {
                return cached;
            } else {
                console.warn(`[ServiceLocator] 缓存的服务实例 [${ServiceLocator.getTokenName(token)}] 判定已失效，自动清除无效引用`);
                this._instances.delete(token);
            }
        }

        // 2. 查找当前定位器中的注册项
        const binding = this._bindings.get(token);
        if (binding) {
            return this._createByBinding(binding, requestingScope);
        }

        // 3. 若当前定位器没有绑定，尝试向父级查找
        if (this.parent) {
            const parentBinding = this._findBindingInHierarchy(token);
            if (parentBinding) {
                // 如果父级配置的是 Scoped，则应该在当前请求作用域 (requestingScope) 内实例化并缓存！
                if (parentBinding.lifetime === ServiceLifetime.Scoped) {
                    return requestingScope._createByBinding(parentBinding, requestingScope);
                }
            }
            // Singleton 或 Transient 委托父级处理
            return this.parent._resolve<T>(token, requestingScope);
        }

        return undefined;
    }

    private _createByBinding<T>(binding: ServiceBinding<T>, requestingScope: ServiceLocator): T {
        // 循环依赖安全检测
        this._enterResolution(binding.token);

        try {
            let instance: T;

            if (binding.lifetime === ServiceLifetime.Transient) {
                // 瞬态：每次使用请求发起方的定位器上下文重新创建，不缓存
                instance = binding.factory(requestingScope);
                this._triggerInitHook(instance);
                return instance;
            }

            // Singleton 或 Scoped：创建并缓存
            instance = binding.factory(requestingScope);
            this._instances.set(binding.token, instance);

            const record: InstantiatedRecord<T> = {
                token: binding.token,
                instance,
                binding
            };
            this._instantiatedRecords.push(record);

            const initResult = this._triggerInitHook(instance);
            if (initResult instanceof Promise) {
                record.initPromise = initResult;
            }

            return instance;
        } finally {
            this._leaveResolution();
        }
    }

    private _enterResolution(token: ServiceIdentifier): void {
        const root = this._root;
        const stack = root._resolutionStack;
        const index = stack.indexOf(token);
        if (index !== -1) {
            const cycleChain = [...stack.slice(index), token]
                .map(t => ServiceLocator.getTokenName(t))
                .join(' -> ');
            throw new Error(`[ServiceLocator] 检测到循环依赖异常: ${cycleChain}`);
        }
        stack.push(token);
    }

    private _leaveResolution(): void {
        this._root._resolutionStack.pop();
    }

    private _findBindingInHierarchy(token: ServiceIdentifier): ServiceBinding | undefined {
        if (this._bindings.has(token)) {
            return this._bindings.get(token);
        }
        if (this.parent) {
            return this.parent._findBindingInHierarchy(token);
        }
        return undefined;
    }

    private _triggerInitHook(instance: any): void | Promise<void> {
        if (!instance || typeof instance !== 'object') return;

        try {
            if (typeof instance.onServiceInit === 'function') {
                return instance.onServiceInit(this);
            } else if (typeof instance.init === 'function') {
                return instance.init(this);
            }
        } catch (err) {
            console.error(`[ServiceLocator] 服务初始化钩子调用异常:`, err);
        }
    }

    private _disposeInstance(instance: any, binding?: ServiceBinding): void {
        if (!instance) return;

        try {
            if (binding?.onDispose) {
                binding.onDispose(instance);
            } else if (typeof instance.onServiceDispose === 'function') {
                instance.onServiceDispose();
            } else if (typeof instance.dispose === 'function') {
                instance.dispose();
            }
        } catch (err) {
            console.error(`[ServiceLocator] 服务销毁钩子调用异常:`, err);
        }
    }

    private _disposeAllInstances(): void {
        // LIFO 逆序销毁
        while (this._instantiatedRecords.length > 0) {
            const record = this._instantiatedRecords.pop()!;
            this._disposeInstance(record.instance, record.binding);
        }
        this._instances.clear();
    }

    private _isInstanceValid(obj: any, token: ServiceIdentifier): boolean {
        if (obj === null || obj === undefined) return false;
        if (this._validator) {
            try {
                return this._validator(obj, token);
            } catch {
                return true;
            }
        }
        return true;
    }

    private _assertNotDisposed(): void {
        if (this._isDisposed) {
            throw new Error(`[ServiceLocator] 定位器 [${this.name}] 已经处于已销毁 (Disposed) 状态，无法继续调用`);
        }
    }

    public _internalRegister<T>(binding: ServiceBinding<T>, allowOverride: boolean = true): void {
        if (this._bindings.has(binding.token) && !allowOverride) {
            throw new Error(`[ServiceLocator] 服务 [${ServiceLocator.getTokenName(binding.token)}] 已经存在，禁止覆盖注册`);
        }
        this._bindings.set(binding.token, binding);
    }

    public _setInstanceDirectly<T>(
        token: ServiceIdentifier<T>,
        instance: T,
        onDispose?: (instance: T) => void | Promise<void>
    ): void {
        this._instances.set(token, instance);
        this._instantiatedRecords.push({
            token,
            instance,
            binding: {
                token,
                lifetime: ServiceLifetime.Singleton,
                factory: () => instance,
                isConstant: true,
                onDispose
            }
        });
        this._triggerInitHook(instance);
    }

    // ==========================================
    // 调试诊断工具 (Diagnostics)
    // ==========================================

    /**
     * 获取服务标识符的可读名称
     */
    public static getTokenName(token: any): string {
        if (typeof token === 'string') return token;
        if (typeof token === 'symbol') return token.toString();
        if (typeof token === 'function') return token.name || 'AnonymousClass';
        if (token && typeof token === 'object') {
            if ('description' in token && typeof token.description === 'string') {
                return token.description;
            }
            return String(token);
        }
        return String(token);
    }

    /**
     * 生成当前定位器及其子作用域的可读诊断字符串
     */
    public dump(indent: string = ''): string {
        const lines: string[] = [];
        lines.push(`${indent}📦 Locator [${this.name}] (ID: ${this.id}, Disposed: ${this._isDisposed})`);

        if (this._bindings.size === 0) {
            lines.push(`${indent}  (No Registered Bindings)`);
        } else {
            for (const [token, binding] of this._bindings.entries()) {
                const tokenName = ServiceLocator.getTokenName(token);
                const isInstantiated = this._instances.has(token);
                const status = isInstantiated ? '✅ Active' : '⏳ Pending';
                const kind = binding.isConstant ? '[Constant]' : binding.tag ? `[${binding.tag}]` : '';
                lines.push(`${indent}  - ${tokenName} -> Lifetime: ${binding.lifetime} ${kind} (${status})`);
            }
        }

        if (this._childScopes.size > 0) {
            lines.push(`${indent}  Scopes:`);
            for (const child of this._childScopes) {
                lines.push(child.dump(indent + '    '));
            }
        }

        return lines.join('\n');
    }

    /**
     * 控制台打印诊断树
     */
    public printDiagnostics(): void {
        console.log(this.dump());
    }
}
