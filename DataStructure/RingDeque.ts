/** 环形双端队列：事件 FIFO、寻路工作队列及有限缓存；移除元素立即释放引用。 */
export class RingDeque<T> implements Iterable<T> {
    private buffer: (T | undefined)[];
    private head = 0;
    private length = 0;
    private revision = 0;

    constructor(initialCapacity = 16) {
        if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 1 || initialCapacity > 0xffffffff)
            throw new RangeError('队列初始容量必须为有效的正整数数组长度');
        this.buffer = new Array<T | undefined>(initialCapacity);
    }

    get size(): number { return this.length; }
    /** 扩容摊销 O(1)，不移动已有元素来完成普通入队。 */
    pushBack(value: T): void {
        this.ensureSpace();
        this.buffer[(this.head + this.length) % this.buffer.length] = value;
        this.length++; this.revision++;
    }
    pushFront(value: T): void {
        this.ensureSpace();
        this.head = (this.head + this.buffer.length - 1) % this.buffer.length;
        this.buffer[this.head] = value;
        this.length++; this.revision++;
    }
    /** 空队列返回 undefined；若 T 包含 undefined，可先读取 size 区分。 */
    popFront(): T | undefined {
        if (!this.length) return undefined;
        const value = this.buffer[this.head];
        this.buffer[this.head] = undefined;
        this.head = (this.head + 1) % this.buffer.length;
        this.length--; this.revision++;
        if (!this.length) this.head = 0;
        return value;
    }
    popBack(): T | undefined {
        if (!this.length) return undefined;
        const index = (this.head + this.length - 1) % this.buffer.length;
        const value = this.buffer[index];
        this.buffer[index] = undefined;
        this.length--; this.revision++;
        if (!this.length) this.head = 0;
        return value;
    }
    peekFront(): T | undefined { return this.length ? this.buffer[this.head] : undefined; }
    peekBack(): T | undefined { return this.length ? this.buffer[(this.head + this.length - 1) % this.buffer.length] : undefined; }
    /** 释放所有元素引用，保留已分配的容量供下一批任务使用。 */
    clear(): void {
        if (!this.length) return;
        this.buffer.fill(undefined); this.head = 0; this.length = 0; this.revision++;
    }
    toArray(): T[] { return Array.from(this); }
    /** 迭代开始后发生增删会抛错；需要边遍历边修改时使用 toArray 快照。 */
    *[Symbol.iterator](): IterableIterator<T> {
        const revision = this.revision;
        for (let i = 0; i < this.length; i++) {
            if (revision !== this.revision) throw new Error('队列迭代期间不能修改容器');
            yield this.buffer[(this.head + i) % this.buffer.length] as T;
        }
        if (revision !== this.revision) throw new Error('队列迭代期间不能修改容器');
    }
    private ensureSpace(): void {
        if (this.length < this.buffer.length) return;
        if (this.length === 0xffffffff) throw new RangeError('队列已达到数组容量上限');
        const next = new Array<T | undefined>(Math.min(0xffffffff, this.buffer.length * 2));
        for (let i = 0; i < this.length; i++) next[i] = this.buffer[(this.head + i) % this.buffer.length];
        this.buffer = next; this.head = 0;
    }
}
