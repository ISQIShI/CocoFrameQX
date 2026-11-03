export interface WeightedEntry<T> { readonly value: T; readonly weight: number }

/** 固定槽位、动态权重的掉落/刷怪表；线段树构建 O(n)，修改及独立抽样 O(log n)。 */
export class WeightedTable<T> {
    private readonly values: T[];
    private readonly tree: Float64Array;
    private readonly leaves: number;
    constructor(entries: readonly WeightedEntry<T>[]) {
        this.values = entries.map(entry => entry.value);
        let leaves = 1;
        while (leaves < entries.length) leaves *= 2;
        this.leaves = leaves; this.tree = new Float64Array(leaves * 2);
        entries.forEach((entry, index) => { this.validateWeight(entry.weight); this.tree[leaves + index] = entry.weight; });
        for (let i = leaves - 1; i > 0; i--) {
            const sum = this.tree[i * 2] + this.tree[i * 2 + 1];
            if (!Number.isFinite(sum)) throw new RangeError('总权重溢出');
            this.tree[i] = sum;
        }
    }
    get size(): number { return this.values.length; }
    get totalWeight(): number { return this.tree[1]; }
    valueAt(index: number): T { this.validateIndex(index); return this.values[index]; }
    weightAt(index: number): number { this.validateIndex(index); return this.tree[this.leaves + index]; }
    /** 先计算整条更新路径，拒绝溢出时原表完全保留；零权重表示暂停该槽位。 */
    setWeight(index: number, weight: number): void {
        this.validateIndex(index); this.validateWeight(weight);
        const changes: [number, number][] = [];
        let node = this.leaves + index, sum = weight;
        changes.push([node, sum]);
        while (node > 1) {
            sum += this.tree[node % 2 === 0 ? node + 1 : node - 1];
            if (!Number.isFinite(sum)) throw new RangeError('总权重溢出，未修改权重表');
            node = Math.floor(node / 2); changes.push([node, sum]);
        }
        for (const [key, value] of changes) this.tree[key] = value;
    }
    /** RNG 必须返回 [0,1)；可注入有种子随机源。空表或全零权重抛错，不偷偷补保底。 */
    sample(random: () => number = Math.random): T {
        const unit = random();
        if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new RangeError('随机源必须返回 [0,1) 内的有限数值');
        const total = this.totalWeight;
        if (!(total > 0)) throw new RangeError('不能从零总权重的表中抽取');
        let target = unit * total, node = 1;
        while (node < this.leaves) {
            const left = this.tree[node * 2], right = this.tree[node * 2 + 1];
            // 极小浮点数乘法可能舍入到区间右端；仍只进入有正权重的分支。
            if (left > 0 && (target < left || right === 0)) node *= 2;
            else { target -= left; node = node * 2 + 1; }
        }
        return this.values[node - this.leaves];
    }
    private validateIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.size) throw new RangeError('权重槽位越界');
    }
    private validateWeight(weight: number): void {
        if (!Number.isFinite(weight) || weight < 0) throw new RangeError('权重必须为有限非负数');
    }
}
