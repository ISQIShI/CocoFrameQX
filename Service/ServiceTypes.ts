/** 类型令牌按对象身份隔离；同名令牌仍是不同服务，泛型保持不变性。 */
export class ServiceToken<T> {
    private readonly type!: (value: T) => T;
    constructor(readonly description: string) { Object.freeze(this); }
    toString(): string { void this.type; return this.description; }
}
export function createServiceToken<T>(description: string): ServiceToken<T> { return new ServiceToken<T>(description); }
export type ServiceLifetime = 'singleton' | 'scoped' | 'transient';
export interface ServiceResolver {
    get<T>(token: ServiceToken<T>): T;
    getAsync<T>(token: ServiceToken<T>): Promise<T>;
}
export interface ServiceOptions<T> {
    lifetime?: ServiceLifetime;
    /** 显式释放回调；没有回调时只清除容器引用，不推测对象方法。 */
    dispose?: (value: T) => void | Promise<void>;
    /** 失效实例报错，不隐式重建，以免隐藏场景所有权错误。 */
    isValid?: (value: T) => boolean;
}
export interface SyncServiceOptions<T> extends ServiceOptions<T> {
    initialize?: (value: T, resolver: ServiceResolver) => void;
}
export interface AsyncServiceOptions<T> extends ServiceOptions<T> {
    initialize?: (value: T, resolver: ServiceResolver) => void | Promise<void>;
}
export interface ServiceInspection {
    readonly name: string;
    readonly state: 'configuring' | 'active' | 'disposing' | 'disposed';
    readonly registrations: number;
    readonly instances: readonly { readonly token: string; readonly state: string; readonly lifetime: ServiceLifetime }[];
}
export class ServiceError extends Error {
    constructor(readonly code: 'missing' | 'disposed' | 'registration' | 'async' | 'cycle' | 'ownership' | 'invalid', message: string) {
        super(message); this.name = 'ServiceError';
    }
}
/** 兼容 ES2017；释放继续执行，并将所有错误交给调用方。 */
export class ServiceDisposalError extends Error {
    constructor(readonly errors: readonly unknown[]) { super('一个或多个服务释放失败'); this.name = 'ServiceDisposalError'; }
}
