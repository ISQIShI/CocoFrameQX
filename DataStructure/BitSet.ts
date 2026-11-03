/** 固定容量的位集合：技能解锁、格子访问和状态索引；索引不是实体引用或代次。 */
export class BitSet implements Iterable<number> {
    private readonly words: Uint32Array;
    private population = 0;
    private revision = 0;
    constructor(readonly capacity: number) {
        if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 0xffffffff)
            throw new RangeError('位集合容量必须为零至 2^32-1 的整数');
        this.words = new Uint32Array(Math.ceil(capacity / 32));
    }
    get size(): number { return this.population; }
    has(index: number): boolean { this.validate(index); return (this.words[Math.floor(index / 32)] & (1 << (index % 32))) !== 0; }
    add(index: number): boolean {
        if (this.has(index)) return false;
        this.words[Math.floor(index / 32)] |= 1 << (index % 32);
        this.population++; this.revision++; return true;
    }
    delete(index: number): boolean {
        if (!this.has(index)) return false;
        this.words[Math.floor(index / 32)] &= ~(1 << (index % 32));
        this.population--; this.revision++; return true;
    }
    clear(): void {
        if (!this.population) return;
        this.words.fill(0); this.population = 0; this.revision++;
    }
    unionWith(other: BitSet): void { this.combine(other, false); }
    intersectWith(other: BitSet): void { this.combine(other, true); }
    clone(): BitSet {
        const result = new BitSet(this.capacity); result.words.set(this.words); result.population = this.population; return result;
    }
    /** 升序遍历已置位索引，迭代期间的有效修改会抛错。 */
    *[Symbol.iterator](): IterableIterator<number> {
        const revision = this.revision;
        for (let i = 0; i < this.words.length; i++) {
            let word = this.words[i];
            while (word) {
                if (revision !== this.revision) throw new Error('位集合迭代期间不能修改容器');
                yield i * 32 + 31 - Math.clz32(word & -word);
                word = (word & (word - 1)) >>> 0;
            }
        }
        if (revision !== this.revision) throw new Error('位集合迭代期间不能修改容器');
    }
    private validate(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.capacity) throw new RangeError('位索引越界');
    }
    private combine(other: BitSet, intersection: boolean): void {
        if (other.capacity !== this.capacity) throw new RangeError('位集合运算要求容量相同');
        let changed = false, size = 0;
        for (let i = 0; i < this.words.length; i++) {
            const word = (intersection ? this.words[i] & other.words[i] : this.words[i] | other.words[i]) >>> 0;
            if (word !== this.words[i]) { changed = true; this.words[i] = word; }
            let remaining = word;
            while (remaining) { size++; remaining = (remaining & (remaining - 1)) >>> 0; }
        }
        this.population = size; if (changed) this.revision++;
    }
}
