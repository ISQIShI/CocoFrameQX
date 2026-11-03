declare const priorityHandleBrand: unique symbol;
/** 不透明身份：仅在创建它的队列中、该项出队或删除前有效；不复用旧句柄。 */
export interface PriorityHandle { readonly [priorityHandleBrand]: true }
interface Entry<T> { value: T; priority: number; order: number; index: number; handle: PriorityHandle }

/** 最小优先堆：时间/代价越小越先出队，同优先级按最初入队顺序，改优先级不重排资历。 */
export class StablePriorityQueue<T> {
    private readonly heap: Entry<T>[] = [];
    private readonly entries = new Map<PriorityHandle, Entry<T>>();
    private sequence = 0;
    get size(): number { return this.heap.length; }
    has(handle: PriorityHandle): boolean { return this.entries.has(handle); }
    enqueue(value: T, priority: number): PriorityHandle {
        this.validatePriority(priority);
        if (this.sequence === Number.MAX_SAFE_INTEGER) throw new RangeError('优先队列序号已耗尽，请清空后重建任务');
        const handle = Object.freeze({}) as PriorityHandle;
        const entry = { value, priority, order: this.sequence++, index: this.heap.length, handle };
        this.entries.set(handle, entry); this.heap.push(entry); this.up(entry.index);
        return handle;
    }
    peek(): T | undefined { return this.heap[0]?.value; }
    dequeue(): T | undefined {
        const entry = this.heap[0];
        if (!entry) return undefined;
        this.remove(entry.handle); return entry.value;
    }
    /** 已出队、已清空或来自另一队列的句柄返回 false，不影响现有任务。 */
    remove(handle: PriorityHandle): boolean {
        const entry = this.entries.get(handle);
        if (!entry) return false;
        const last = this.heap.pop()!;
        this.entries.delete(handle);
        if (entry.index < this.heap.length) {
            this.heap[entry.index] = last; last.index = entry.index; this.repair(last.index);
        }
        if (!this.heap.length) this.sequence = 0;
        return true;
    }
    setPriority(handle: PriorityHandle, priority: number): boolean {
        const entry = this.entries.get(handle);
        if (!entry) return false;
        this.validatePriority(priority); entry.priority = priority; this.repair(entry.index); return true;
    }
    clear(): void { this.heap.length = 0; this.entries.clear(); this.sequence = 0; }
    private validatePriority(priority: number): void {
        if (!Number.isFinite(priority)) throw new RangeError('优先级必须为有限数值');
    }
    private less(a: Entry<T>, b: Entry<T>): boolean { return a.priority < b.priority || (a.priority === b.priority && a.order < b.order); }
    private swap(a: number, b: number): void {
        const item = this.heap[a]; this.heap[a] = this.heap[b]; this.heap[b] = item;
        this.heap[a].index = a; this.heap[b].index = b;
    }
    private repair(index: number): void {
        if (index > 0 && this.less(this.heap[index], this.heap[Math.floor((index - 1) / 2)])) this.up(index);
        else this.down(index);
    }
    private up(start: number): void {
        let index = start;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!this.less(this.heap[index], this.heap[parent])) break;
            this.swap(index, parent); index = parent;
        }
    }
    private down(start: number): void {
        let index = start;
        while (index * 2 + 1 < this.heap.length) {
            let child = index * 2 + 1;
            if (child + 1 < this.heap.length && this.less(this.heap[child + 1], this.heap[child])) child++;
            if (!this.less(this.heap[child], this.heap[index])) break;
            this.swap(index, child); index = child;
        }
    }
}
