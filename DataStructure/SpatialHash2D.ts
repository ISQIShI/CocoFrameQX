/** 闭区间轴对齐包围盒；俯视游戏可将世界 Z 映射到这里的 Y。 */
export interface Bounds2D { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
interface SpatialEntry { bounds: Bounds2D; cells: string[] }

/** 动态二维空间索引：复制包围盒、跨格登记、结果去重，查询返回真实 AABB 相交候选。 */
export class SpatialHash2D<T> {
    private readonly entries = new Map<T, SpatialEntry>();
    private readonly buckets = new Map<string, Set<T>>();
    constructor(readonly cellSize: number, readonly maxCellsPerOperation = 4096) {
        if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('网格尺寸必须为有限正数');
        if (!Number.isSafeInteger(maxCellsPerOperation) || maxCellsPerOperation < 1) throw new RangeError('单次网格访问上限必须为正整数');
    }
    get size(): number { return this.entries.size; }
    has(value: T): boolean { return this.entries.has(value); }
    /** 校验和生成新格子成功后才替换旧记录，非法更新不会丢失原实体。 */
    set(value: T, bounds: Bounds2D): void {
        const copy = { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY };
        const cells = this.cellsFor(copy);
        this.delete(value);
        for (const cell of cells) {
            let bucket = this.buckets.get(cell);
            if (!bucket) { bucket = new Set<T>(); this.buckets.set(cell, bucket); }
            bucket.add(value);
        }
        this.entries.set(value, { bounds: copy, cells });
    }
    delete(value: T): boolean {
        const entry = this.entries.get(value);
        if (!entry) return false;
        for (const cell of entry.cells) {
            const bucket = this.buckets.get(cell)!; bucket.delete(value);
            if (!bucket.size) this.buckets.delete(cell);
        }
        this.entries.delete(value); return true;
    }
    /** 可复用 out；成功查询先清空旧结果，拒绝非法查询时保留 out。接触边界也视为相交。 */
    query(bounds: Bounds2D, out: Set<T> = new Set<T>()): Set<T> {
        const cells = this.cellsFor(bounds);
        out.clear();
        for (const cell of cells) {
            const bucket = this.buckets.get(cell);
            if (!bucket) continue;
            for (const value of bucket) {
                const b = this.entries.get(value)!.bounds;
                if (b.minX <= bounds.maxX && b.maxX >= bounds.minX && b.minY <= bounds.maxY && b.maxY >= bounds.minY) out.add(value);
            }
        }
        return out;
    }
    getBounds(value: T): Bounds2D | undefined {
        const bounds = this.entries.get(value)?.bounds;
        return bounds ? { ...bounds } : undefined;
    }
    clear(): void { this.entries.clear(); this.buckets.clear(); }
    private cellsFor(bounds: Bounds2D): string[] {
        const { minX, minY, maxX, maxY } = bounds;
        if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX > maxX || minY > maxY) throw new RangeError('包围盒必须为有序的有限坐标');
        const left = Math.floor(minX / this.cellSize), right = Math.floor(maxX / this.cellSize);
        const bottom = Math.floor(minY / this.cellSize), top = Math.floor(maxY / this.cellSize);
        if (![left, right, bottom, top].every(Number.isSafeInteger)) throw new RangeError('网格坐标超出安全整数范围');
        const width = right - left + 1, height = top - bottom + 1;
        if (width > this.maxCellsPerOperation / height) throw new RangeError('包围盒超出单次网格访问上限');
        const cells: string[] = [];
        for (let x = left; x <= right; x++) for (let y = bottom; y <= top; y++) cells.push(`${x},${y}`);
        return cells;
    }
}
