export class FlagUtil {

    /**
     * 检查掩码是否包含指定的标记
     * @param mask 掩码
     * @param flag 标记
     * @returns 
     */
    public static has(mask: number, flag: number): boolean {
        return (mask & flag) === flag;
    }

    /**
     * 添加标记
     * @param mask 掩码
     * @param flag 标记
     * @returns 
     */
    public static add(mask: number, flag: number): number {
        return mask | flag;
    }

    /**
     * 移除标记
     * @param mask 掩码
     * @param flag 标记
     * @returns 
     */
    public static remove(mask: number, flag: number): number {
        return mask & ~flag;
    }

    /**
     * 切换标记
     * @param mask 掩码
     * @param flag 标记
     * @returns 
     */
    public static toggle(mask: number, flag: number): number {
        return mask ^ flag;
    }
}

