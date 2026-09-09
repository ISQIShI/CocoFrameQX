import { math, Vec3 } from 'cc';

export type RandomSource = () => number;

export class RandomUtil {
    /** 返回 [0, 1) 范围内的随机数，可作为自定义随机算法的默认随机源。 */
    public static value(random: RandomSource = Math.random): number {
        return random();
    }

    /**
     * 获取指定范围内的随机整数
     * @param min 最小值（包含）
     * @param max 最大值（包含）
     */
    public static getRandomInt(min: number, max: number, random: RandomSource = Math.random): number {
        const range = RandomUtil._normalizeRange(min, max);
        const lower = Math.ceil(range.min);
        const upper = Math.floor(range.max);
        if (lower > upper) {
            throw new RangeError(`[RandomUtil] 整数范围内没有可用值：${min}, ${max}`);
        }
        return Math.floor(random() * (upper - lower + 1)) + lower;
    }

    /**
     * 获取指定范围内的随机浮点数
     * @param min 最小值（包含）
     * @param max 最大值（不包含，min === max 时除外）
     */
    public static getRandomFloat(min: number, max: number, random: RandomSource = Math.random): number {
        const range = RandomUtil._normalizeRange(min, max);
        return random() * (range.max - range.min) + range.min;
    }

    /** 按概率返回 true。probability 会被限制在 [0, 1]。 */
    public static chance(probability: number, random: RandomSource = Math.random): boolean {
        return random() < math.clamp01(probability);
    }

    /** 随机返回 -1 或 1。 */
    public static sign(random: RandomSource = Math.random): number {
        return random() < 0.5 ? -1 : 1;
    }

    /** 从数组中均匀随机选择一个元素。空数组返回 undefined。 */
    public static pick<T>(items: readonly T[], random: RandomSource = Math.random): T | undefined {
        if (items.length === 0) return undefined;
        return items[RandomUtil.getRandomInt(0, items.length - 1, random)];
    }

    /**
     * 按权重随机选择元素。
     * 权重不要求归一化；权重小于等于 0 的元素不会被选中。
     */
    public static pickWeighted<T>(items: readonly T[], weights: readonly number[], random: RandomSource = Math.random): T | undefined {
        if (items.length === 0) return undefined;
        if (items.length !== weights.length) {
            throw new RangeError('[RandomUtil] items 与 weights 长度必须一致');
        }

        let totalWeight = 0;
        for (const weight of weights) {
            if (Number.isFinite(weight) && weight > 0) totalWeight += weight;
        }
        if (totalWeight <= 0) return undefined;

        let remaining = random() * totalWeight;
        let lastValidIndex = -1;
        for (let i = 0; i < items.length; i++) {
            const weight = weights[i];
            if (!Number.isFinite(weight) || weight <= 0) continue;
            lastValidIndex = i;
            remaining -= weight;
            if (remaining < 0) return items[i];
        }
        return items[lastValidIndex];
    }

    /** 原地洗牌，返回传入数组，适合洗牌、随机生成出生顺序等场景。 */
    public static shuffle<T>(items: T[], random: RandomSource = Math.random): T[] {
        for (let i = items.length - 1; i > 0; i--) {
            const j = RandomUtil.getRandomInt(0, i, random);
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }

    /** 获取圆盘内的随机二维坐标，结果写入 out.x / out.z，y 保持不变。 */
    public static getRandomPositionInCircle(center: Vec3, radius: number, out: Vec3, random: RandomSource = Math.random): Vec3 {
        const safeRadius = Math.max(0, radius);
        const angle = RandomUtil.getRandomFloat(0, Math.PI * 2, random);
        const distance = Math.sqrt(random()) * safeRadius;
        out.set(
            center.x + Math.cos(angle) * distance,
            center.y,
            center.z + Math.sin(angle) * distance
        );
        return out;
    }

    /** 获取球体内的随机坐标，结果写入 out。 */
    public static getRandomPositionInSphere(center: Vec3, radius: number, out: Vec3, random: RandomSource = Math.random): Vec3 {
        const safeRadius = Math.max(0, radius);
        const z = RandomUtil.getRandomFloat(-1, 1, random);
        const angle = RandomUtil.getRandomFloat(0, Math.PI * 2, random);
        const horizontal = Math.sqrt(1 - z * z);
        const distance = Math.cbrt(random()) * safeRadius;
        out.set(
            center.x + horizontal * Math.cos(angle) * distance,
            center.y + z * distance,
            center.z + horizontal * Math.sin(angle) * distance
        );
        return out;
    }

    /**
     * 获取立方体内的随机坐标
     * @param center 中心点
     * @param length 立方体的长
     * @param width 立方体的宽
     * @param height 立方体的高
     * @param out 输出的随机坐标
     * @returns 输出的随机坐标
     */
    public static getRandomPositionInCube(center: Vec3, length: number, width: number, height: number, out: Vec3, random: RandomSource = Math.random): Vec3 {
        const halfLength = Math.abs(length) / 2;
        const halfWidth = Math.abs(width) / 2;
        const halfHeight = Math.abs(height) / 2;
        out.set(
            RandomUtil.getRandomFloat(center.x - halfLength, center.x + halfLength, random),
            RandomUtil.getRandomFloat(center.y - halfHeight, center.y + halfHeight, random),
            RandomUtil.getRandomFloat(center.z - halfWidth, center.z + halfWidth, random)
        );
        return out;
    }

    /** 创建可复现的伪随机数生成器，适合关卡重放、战斗回放和固定种子测试。 */
    public static createSeededRandom(seed: number): RandomSource {
        let state = (seed >>> 0) || 0x6d2b79f5;
        return () => {
            state = (state + 0x6d2b79f5) | 0;
            let value = Math.imul(state ^ (state >>> 15), 1 | state);
            value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    private static _normalizeRange(min: number, max: number): { min: number; max: number } {
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            throw new RangeError(`[RandomUtil] 范围必须是有限数字：${min}, ${max}`);
        }
        return min <= max ? { min, max } : { min: max, max: min };
    }
}


