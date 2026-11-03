/** 紧凑活动集合：平均 O(1) 增删/查询，连续数组遍历；删除会交换末项，不保证顺序。 */
export class DenseSet<T> implements Iterable<T> {
    private readonly indices = new Map<T, number>();
    private readonly items: T[] = [];
    private revision = 0;
    get size(): number { return this.items.length; }
    has(value: T): boolean { return this.indices.has(value); }
    add(value: T): boolean {
        if (this.indices.has(value)) return false;
        this.indices.set(value, this.items.length); this.items.push(value); this.revision++;
        return true;
    }
    delete(value: T): boolean {
        const index = this.indices.get(value);
        if (index === undefined) return false;
        const last = this.items.pop()!;
        this.indices.delete(value);
        if (index < this.items.length) { this.items[index] = last; this.indices.set(last, index); }
        this.revision++; return true;
    }
    /** 序号只在本次结构修改前有效，不能当成实体 ID 保存。 */
    at(index: number): T | undefined { return Number.isInteger(index) && index >= 0 ? this.items[index] : undefined; }
    clear(): void {
        if (!this.items.length) return;
        this.items.length = 0; this.indices.clear(); this.revision++;
    }
    toArray(): T[] { return this.items.slice(); }
    *[Symbol.iterator](): IterableIterator<T> {
        const revision = this.revision;
        for (let i = 0; i < this.items.length; i++) {
            if (revision !== this.revision) throw new Error('紧凑集合迭代期间不能修改容器');
            yield this.items[i];
        }
        if (revision !== this.revision) throw new Error('紧凑集合迭代期间不能修改容器');
    }
}
