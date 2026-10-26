import { JsonAsset, resources } from 'cc';
import { ConfigStore } from './ConfigStore';
import { ConfigError, ConfigSchema } from './ConfigTypes';

/** 将 Inspector 引用的 JSON 资源作为项目层应用；资源内容也必须含项目和版本信息。 */
export function applyProjectConfig<S extends ConfigSchema>(store: ConfigStore<S>, asset: JsonAsset): void {
    if (store.snapshot().started) throw new ConfigError(['项目配置必须在游戏创建之前加载，运行中请使用测试覆盖层']);
    store.importDocument(asset.json, '项目');
}

/**
 * 从 resources 加载项目配置，调用方必须 await 后再创建游戏系统。
 * 超时只终止本次应用，不取消引擎共享资源请求；迟到回调不会再写入配置。
 */
export function loadProjectConfig<S extends ConfigSchema>(store: ConfigStore<S>, path: string, timeoutMs = 5000): Promise<void> {
    if (store.snapshot().started) return Promise.reject(new ConfigError(['配置已经进入运行阶段，不能再次启动项目资源加载']));
    if (!path.trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
        return Promise.reject(new ConfigError(['项目配置路径不能为空，加载超时必须为有限正数']));
    return new Promise((resolve, reject) => {
        let finished = false;
        /** 只结束一次请求，清除计时，避免资源加载回调超时后改写配置。 */
        const complete = (error?: unknown): void => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => complete(new ConfigError(['项目配置加载超时：' + path])), timeoutMs);
        try {
            resources.load(path, JsonAsset, (error, asset) => {
                if (finished) return;
                if (error || !asset) { complete(new ConfigError(['项目配置加载失败：' + path])); return; }
                try { applyProjectConfig(store, asset); complete(); }
                catch (failure) { complete(failure); }
            });
        } catch (error) { complete(error); }
    });
}
