export interface AudioClipLease<Clip extends object> {
    readonly clip: Clip;
    /** 归还这份独立引用，重复调用无副作用。 */
    release(): void;
}

export interface AudioClipProvider<Key, Clip extends object> {
    /** 只查已经就绪的资源。缓存未命中时返回 undefined。 */
    tryAcquire(key: Key): AudioClipLease<Clip> | undefined;
    acquire(key: Key, signal?: AbortSignal): Promise<AudioClipLease<Clip>>;
}
