import { AsyncServiceOptions, ServiceDisposalError, ServiceError, ServiceInspection, ServiceOptions, ServiceResolver,
    ServiceToken, SyncServiceOptions } from './ServiceTypes';
import { InstanceRecord, isPromiseLike, Registration } from './BindingBuilder';

/** 所有权为模块级弱表：不同根容器也不能同时接管同一个可释放对象。 */
const ownership = new WeakMap<object, InstanceRecord>();
let completionOrder = 0;

/** 显式工厂与层级生命周期容器。工厂 resolver 只在创建/初始化期间有效。 */
export class ServiceLocator implements ServiceResolver {
    private readonly bindings = new Map<ServiceToken<any>, Registration>();
    private readonly cache = new Map<Registration, InstanceRecord>();
    private readonly records: InstanceRecord[] = [];
    private readonly children = new Set<ServiceLocator>();
    private state: ServiceInspection['state'] = 'configuring';
    private disposal?: Promise<void>;
    private parent?: ServiceLocator;
    constructor(readonly name = 'Root') {}

    registerFactory<T>(token: ServiceToken<T>, factory: (resolver: ServiceResolver) => T, options: SyncServiceOptions<T> = {}): this {
        return this.register(token, factory, options, false, false);
    }
    registerAsyncFactory<T>(token: ServiceToken<T>, factory: (resolver: ServiceResolver) => T | Promise<T>, options: AsyncServiceOptions<T> = {}): this {
        return this.register(token, factory, options, true, false);
    }
    /** 默认借用外部实例。提供 dispose 即转移所有权，注册时立即接管，即使从未解析也会释放。 */
    registerValue<T>(token: ServiceToken<T>, value: T, options: Omit<ServiceOptions<T>, 'lifetime'> = {}): this {
        if (value === undefined || value === null || (options.isValid && !options.isValid(value)))
            throw new ServiceError('invalid', '不能注册空值或失效实例：' + token.description);
        this.register(token, () => value, { ...options, lifetime: 'singleton' }, false, true);
        const binding = this.bindings.get(token)!;
        binding.value = value;
        const record = this.newRecord(binding, this);
        try { this.acceptValue(record, value); record.state = 'ready'; record.order = ++completionOrder; }
        catch (error) { this.cache.delete(binding); this.records.splice(this.records.indexOf(record), 1); this.bindings.delete(token); throw error; }
        return this;
    }
    createScope(name = 'Scope'): ServiceLocator {
        this.assertOpen(); this.state = 'active';
        const child = new ServiceLocator(name); child.parent = this; this.children.add(child); return child;
    }
    has<T>(token: ServiceToken<T>): boolean { this.assertOpen(); return !!this.find(token); }
    get<T>(token: ServiceToken<T>): T { return this.resolve(token, false) as T; }
    getAsync<T>(token: ServiceToken<T>): Promise<T> {
        try { return Promise.resolve(this.resolve(token, true)).then(value => { this.assertOpen(); return value; }); }
        catch (error) { return Promise.reject(error); }
    }
    inspect(): ServiceInspection {
        return Object.freeze({ name: this.name, state: this.state, registrations: this.bindings.size,
            instances: Object.freeze(this.records.map(r => Object.freeze({ token: r.registration.token.description,
                state: r.state, lifetime: r.registration.lifetime }))) });
    }
    /** 首次调用立即封闭整棵子树。等待在途工厂，再按依赖图逆拓扑释放。 */
    disposeAsync(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.state = 'disposing';
        // 在调用用户代码前存放 promise，保证重复/重入释放复用同一次结果。
        let finish!: () => void, fail!: (error: unknown) => void;
        this.disposal = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
        const childDisposals = Array.from(this.children).reverse().map(child => child.disposeAsync());
        this.disposeRecords(childDisposals).then(finish, fail);
        return this.disposal;
    }
    private async disposeRecords(children: Promise<void>[]): Promise<void> {
        const errors: unknown[] = [];
        await Promise.all(children.map(async child => { try { await child; } catch (error) { errors.push(error); } }));
        // 状态已封闭，初始化中的 resolver 不能再启动新依赖。
        await Promise.all(this.records.map(r => r.promise ? r.promise.catch(() => undefined) : Promise.resolve()));
        const local = new Set(this.records), visited = new Set<InstanceRecord>(), ordered: InstanceRecord[] = [];
        const visit = (record: InstanceRecord) => {
            if (visited.has(record)) return;
            visited.add(record);
            // 即使同步服务持有异步依赖 Promise，也必须先释放使用者。
            for (const dependent of record.dependents) if (local.has(dependent)) visit(dependent);
            ordered.push(record);
        };
        for (const record of this.records.slice().sort((a, b) => b.order - a.order)) visit(record);
        for (const record of ordered) {
            try { await this.release(record); } catch (error) { errors.push(error); }
        }
        this.cache.clear(); this.records.length = 0; this.bindings.clear(); this.children.clear();
        this.parent?.children.delete(this); this.parent = undefined; this.state = 'disposed';
        if (errors.length) throw new ServiceDisposalError(Object.freeze(errors));
    }
    private register<T>(token: ServiceToken<T>, factory: (resolver: ServiceResolver) => T | Promise<T>,
        options: AsyncServiceOptions<T>, async: boolean, isValue: boolean): this {
        this.assertOpen();
        if (this.state !== 'configuring') throw new ServiceError('registration', '首次解析或创建子作用域后禁止修改注册表');
        if (!(token instanceof ServiceToken) || typeof factory !== 'function') throw new ServiceError('registration', '需要类型令牌和显式工厂');
        if (this.bindings.has(token)) throw new ServiceError('registration', '重复注册：' + token.description);
        const lifetime = options.lifetime ?? 'singleton';
        if (['singleton', 'scoped', 'transient'].indexOf(lifetime) < 0) throw new ServiceError('registration', '未知生命周期');
        this.bindings.set(token, { token, owner: this, factory, options: { ...options }, lifetime, async, isValue });
        return this;
    }
    private find(token: ServiceToken<any>): Registration | undefined { return this.bindings.get(token) ?? this.parent?.find(token); }
    private assertOpen(): void {
        if (this.state === 'disposing' || this.state === 'disposed') throw new ServiceError('disposed', '作用域已关闭：' + this.name);
        this.parent?.assertOpen();
    }
    private resolve(token: ServiceToken<any>, async: boolean, dependent?: InstanceRecord): any {
        this.assertOpen(); this.state = 'active';
        const registration = this.find(token);
        if (!registration) throw new ServiceError('missing', '未注册服务：' + token.description);
        // 防止长生命周期单例捕获短生命周期子作用域的覆盖项。
        const owner = registration.lifetime === 'singleton' ? registration.owner : this;
        owner.assertOpen(); owner.state = 'active';
        let record = registration.lifetime === 'transient' ? undefined : owner.cache.get(registration);
        if (!async && registration.async && record?.state !== 'ready') throw new ServiceError('async', '异步服务请使用 getAsync：' + token.description);
        if (!record) {
            record = owner.newRecord(registration, owner);
            try { if (dependent) this.link(dependent, record); }
            catch (error) { owner.cache.delete(registration); owner.records.splice(owner.records.indexOf(record), 1); throw error; }
            owner.start(record);
        } else if (dependent) this.link(dependent, record);
        if (record.state === 'failed') throw record.error;
        if (record.state === 'ready') {
            this.validate(record); return record.value;
        }
        if (!async) throw new ServiceError('async', '服务尚未就绪：' + token.description);
        if (!record.promise) throw new ServiceError('cycle', '同步初始化期间重入：' + token.description);
        return record.promise.then(value => { this.assertOpen(); this.validate(record!); return value; });
    }
    private newRecord(registration: Registration, owner: ServiceLocator): InstanceRecord {
        const record: InstanceRecord = { registration, owner, state: 'creating', value: undefined, hasValue: false,
            owned: false, dependencies: new Set(), dependents: new Set(), order: 0 };
        owner.records.push(record);
        if (registration.lifetime !== 'transient') owner.cache.set(registration, record);
        return record;
    }
    private link(from: InstanceRecord, to: InstanceRecord): void {
        const visit = (current: InstanceRecord, seen: Set<InstanceRecord>): boolean => {
            if (current === from) return true;
            if (seen.has(current)) return false;
            seen.add(current);
            return Array.from(current.dependencies).some(next => visit(next, seen));
        };
        const ancestor = (current: InstanceRecord, seen: Set<InstanceRecord>): boolean => {
            if (current.registration === to.registration && current.owner === to.owner) return true;
            if (seen.has(current)) return false;
            seen.add(current);
            return Array.from(current.dependents).some(parent => ancestor(parent, seen));
        };
        if (visit(to, new Set()) || ancestor(from, new Set())) throw new ServiceError('cycle', '循环依赖：' + from.registration.token.description + ' -> ' + to.registration.token.description);
        from.dependencies.add(to);
        to.dependents.add(from);
    }
    private resolver(record: InstanceRecord): ServiceResolver {
        const check = () => {
            if (record.state !== 'creating') throw new ServiceError('invalid', '工厂 resolver 只能在创建和初始化期间使用');
        };
        return Object.freeze({
            get: <T>(token: ServiceToken<T>): T => { check(); return record.owner.resolve(token, false, record); },
            getAsync: <T>(token: ServiceToken<T>): Promise<T> => {
                try { check(); return Promise.resolve(record.owner.resolve(token, true, record)); } catch (error) { return Promise.reject(error); }
            }
        });
    }
    private start(record: InstanceRecord): void {
        const { registration } = record;
        const resolver = this.resolver(record);
        if (registration.async) {
            record.promise = Promise.resolve().then(() => registration.factory(resolver)).then(value => {
                this.acceptValue(record, value); return registration.options.initialize?.(value, resolver);
            }).then(() => this.ready(record)).catch(error => this.fail(record, error));
            record.promise.catch(() => undefined); // get() 不消费失败时仍避免未处理 rejection。
            return;
        }
        try {
            const value = registration.factory(resolver);
            if (isPromiseLike(value)) {
                record.promise = Promise.resolve(value).then(v => { this.acceptValue(record, v); throw new ServiceError('async', '同步工厂返回 Promise，请改用 registerAsyncFactory'); }).catch(error => this.fail(record, error));
                record.promise.catch(() => undefined);
                throw new ServiceError('async', '同步工厂返回 Promise，请改用 registerAsyncFactory');
            }
            this.acceptValue(record, value);
            const initialized = registration.options.initialize?.(value, resolver);
            if (isPromiseLike(initialized)) {
                record.promise = Promise.resolve(initialized).then(() => { throw new ServiceError('async', '同步初始化返回 Promise，请改用 registerAsyncFactory'); }).catch(error => this.fail(record, error));
                record.promise.catch(() => undefined);
                throw new ServiceError('async', '同步初始化返回 Promise，请改用 registerAsyncFactory');
            }
            this.ready(record);
        } catch (error) {
            // 错误异步返回尚在运行时，交由上面的 promise 等待后清理。
            if (!record.promise) { record.state = 'failed'; record.error = error; record.promise = this.fail(record, error); record.promise.catch(() => undefined); }
            throw error;
        }
    }
    private acceptValue(record: InstanceRecord, value: any): void {
        if (value === undefined || value === null) throw new ServiceError('invalid', '服务工厂不能返回空值');
        const object = (typeof value === 'object' || typeof value === 'function') ? value as object : undefined;
        if (record.registration.options.dispose && object) {
            if (ownership.has(object)) throw new ServiceError('ownership', '实例已经由其他服务记录接管：' + record.registration.token.description);
            ownership.set(object, record); record.owned = true;
        }
        record.value = value; record.hasValue = true;
        if (!record.registration.isValue) this.validate(record);
    }
    private validate(record: InstanceRecord): void {
        if (record.registration.options.isValid && !record.registration.options.isValid(record.value))
            throw new ServiceError('invalid', '服务实例已失效：' + record.registration.token.description);
    }
    private ready(record: InstanceRecord): any {
        record.state = 'ready'; record.order = ++completionOrder; return record.value;
    }
    private async fail(record: InstanceRecord, error: unknown): Promise<never> {
        record.state = 'failed'; record.error = error;
        try { await this.release(record); } catch (cleanup) { record.error = new ServiceDisposalError([error, cleanup]); }
        record.state = 'failed'; throw record.error;
    }
    private async release(record: InstanceRecord): Promise<void> {
        const hasValue = record.hasValue;
        const value = record.value;
        record.hasValue = false; record.value = undefined;
        try { if (hasValue && record.registration.options.dispose) await record.registration.options.dispose(value); }
        finally {
            if (record.owned) { ownership.delete(value); record.owned = false; }
            for (const dependency of record.dependencies) dependency.dependents.delete(record);
            for (const dependent of record.dependents) dependent.dependencies.delete(record);
            record.dependencies.clear(); record.dependents.clear();
            if (record.state !== 'failed') record.state = 'disposed';
        }
    }
}
