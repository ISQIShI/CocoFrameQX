import { JsonAsset, resources } from 'cc';
import { ConfigError } from './ConfigTypes';

/**
 * 从 resources 加载项目配置文档，结果交给 setup(...).projectDocument() 后再 start。
 * 调用方必须 await 后再创建游戏系统；超时只终止本次等待，不取消引擎共享资源请求。
 */
export function loadConfigDocument(path: string, timeoutMs = 5000): Promise<unknown> {
    if (!path.trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return Promise.reject(new ConfigError(['项目配置路径不能为空，加载超时必须为有限正数']));
    return new Promise((resolve, reject) => {
        let finished = false;
        /** 只结束一次请求，清除计时，避免超时后的迟到回调再交付结果。 */
        const complete = (error: unknown, document?: unknown): void => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (error) reject(error); else resolve(document);
        };
        const timer = setTimeout(() => complete(new ConfigError(['项目配置加载超时：' + path])), timeoutMs);
        try {
            resources.load(path, JsonAsset, (error, asset) => {
                if (error || !asset) complete(new ConfigError(['项目配置加载失败：' + path]));
                else complete(null, asset.json);
            });
        } catch (error) { complete(error); }
    });
}
