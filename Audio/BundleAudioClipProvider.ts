import { AudioClip, isValid } from 'cc';
import type { AssetManager } from 'cc';
import type { AudioClipLease, AudioClipProvider } from './AudioClipProvider';

export type AudioClipAcquireErrorCode = 'aborted' | 'closed' | 'evicted' | 'invalid-path' | 'invalid-clip' | 'load';

export class AudioClipAcquireError extends Error {
    constructor(readonly code: AudioClipAcquireErrorCode, readonly path: string, readonly cause?: unknown) {
        super(`Bundle audio ${code}: ${path}`);
        this.name = 'AudioClipAcquireError';
    }
}

interface Waiter {
    resolve(lease: AudioClipLease<AudioClip>): void;
    reject(error: unknown): void;
    detach(): void;
}

interface Entry {
    clip?: AudioClip;
    readonly waiters: Set<Waiter>;
}

/** 对一个已加载的 Bundle 管理缓存。调用方独立持有并归还获取到的租约。 */
export class BundleAudioClipProvider implements AudioClipProvider<string, AudioClip> {
    private readonly entries = new Map<string, Entry>();
    private closed = false;

    constructor(private readonly bundle: AssetManager.Bundle) {}

    tryAcquire(path: string): AudioClipLease<AudioClip> | undefined {
        this.checkPath(path);
        const clip = this.entries.get(path)?.clip;
        return clip ? this.lease(clip) : undefined;
    }

    async acquire(path: string, signal?: AbortSignal): Promise<AudioClipLease<AudioClip>> {
        this.checkPath(path);
        if (signal?.aborted) throw new AudioClipAcquireError('aborted', path);
        const existing = this.entries.get(path);
        if (existing?.clip) return this.lease(existing.clip);

        const entry = existing ?? { waiters: new Set<Waiter>() };
        if (!existing) this.entries.set(path, entry);
        return new Promise((resolve, reject) => {
            const abort = () => {
                if (!entry.waiters.delete(waiter)) return;
                waiter.detach();
                reject(new AudioClipAcquireError('aborted', path));
                // Bundle.load 不提供取消句柄。无人等待时丢弃条目，迟到结果不会进入缓存。
                if (!entry.waiters.size && this.entries.get(path) === entry) this.entries.delete(path);
            };
            const waiter: Waiter = { resolve, reject, detach: () => signal?.removeEventListener('abort', abort) };
            entry.waiters.add(waiter);
            signal?.addEventListener('abort', abort, { once: true });
            if (!existing) this.load(path, entry);
        });
    }

    evict(path: string): void {
        this.discard(path, 'evicted');
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const path of this.entries.keys()) this.discard(path, 'closed');
    }

    private load(path: string, entry: Entry): void {
        try {
            this.bundle.load(path, AudioClip, (error, clip) => {
                if (error || !(clip instanceof AudioClip) || !isValid(clip, true)) {
                    this.fail(path, entry, new AudioClipAcquireError(error ? 'load' : 'invalid-clip', path, error));
                    return;
                }
                // 同一底层资源可能也被别的调用方使用，只归还本次持有的引用。
                clip.addRef();
                if (this.entries.get(path) !== entry || entry.clip) {
                    clip.decRef();
                    return;
                }
                entry.clip = clip;
                for (const waiter of entry.waiters) {
                    waiter.detach();
                    waiter.resolve(this.lease(clip));
                }
                entry.waiters.clear();
            });
        } catch (error) {
            this.fail(path, entry, new AudioClipAcquireError('load', path, error));
        }
    }

    private fail(path: string, entry: Entry, error: AudioClipAcquireError): void {
        if (this.entries.get(path) !== entry || entry.clip) return;
        this.entries.delete(path);
        this.rejectWaiters(entry, error);
    }

    private discard(path: string, code: 'evicted' | 'closed'): void {
        const entry = this.entries.get(path);
        if (!entry) return;
        this.entries.delete(path);
        this.rejectWaiters(entry, new AudioClipAcquireError(code, path));
        entry.clip?.decRef();
    }

    private rejectWaiters(entry: Entry, error: AudioClipAcquireError): void {
        for (const waiter of entry.waiters) {
            waiter.detach();
            waiter.reject(error);
        }
        entry.waiters.clear();
    }

    private lease(clip: AudioClip): AudioClipLease<AudioClip> {
        clip.addRef();
        let released = false;
        return {
            clip,
            release: () => {
                if (released) return;
                released = true;
                clip.decRef();
            },
        };
    }

    private checkPath(path: string): void {
        if (this.closed) throw new AudioClipAcquireError('closed', path);
        if (typeof path !== 'string' || !path.trim()) throw new AudioClipAcquireError('invalid-path', path);
    }
}
