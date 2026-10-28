// 文件名保留资产身份；旧 BindingBuilder 已移除。以下仅供容器内部使用。
import { AsyncServiceOptions, ServiceLifetime, ServiceResolver, ServiceToken } from './ServiceTypes';
import type { ServiceLocator } from './ServiceLocator';
export interface Registration {
    token: ServiceToken<any>;
    owner: ServiceLocator;
    lifetime: ServiceLifetime;
    async: boolean;
    factory: (resolver: ServiceResolver) => any;
    options: AsyncServiceOptions<any>;
    value?: any;
    isValue: boolean;
}
export interface InstanceRecord {
    registration: Registration;
    owner: ServiceLocator;
    state: 'creating' | 'ready' | 'failed' | 'disposed';
    value: any;
    hasValue: boolean;
    owned: boolean;
    error?: unknown;
    promise?: Promise<any>;
    dependencies: Set<InstanceRecord>;
    dependents: Set<InstanceRecord>;
    order: number;
}
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as PromiseLike<unknown>).then === 'function';
}
