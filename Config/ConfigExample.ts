import { ConfigStore } from './ConfigStore';
import { booleanField, choiceField, ConfigDocument, ConfigValue, jsonField, numberField, stringField } from './ConfigTypes';
import { ConfigTestSession } from './ConfigTestSession';
import { ConfigDebugPanel } from './ConfigDebugPanel';

/** 可运行的通用声明示例；仅展示接入方式，不连接 AnimalMerge 或修改其规则。 */
export const EXAMPLE_SCHEMA = {
    'launch.minSpeed': numberField(10, { label: '最小发射速度', group: '发射', min: 0.1, max: 100, step: 0.5, timing: '实时' }),
    'launch.maxSpeed': numberField(25, { label: '最大发射速度', group: '发射', min: 0.1, max: 100, step: 0.5, timing: '实时' }),
    'launch.cooldown': numberField(0.2, { label: '发射间隔', group: '发射', min: 0, max: 5, step: 0.05, timing: '实时', description: '单位秒；游戏应在下一次发射时读取' }),
    'physics.gravity': numberField(-14, { label: '世界重力', group: '物理', min: -50, max: -0.1 }),
    'test.seed': numberField(12345, { label: '测试随机种子', group: '复现', min: 0, max: 2147483647, integer: true }),
    'test.difficulty': choiceField('普通', ['简单', '普通', '困难'] as const, { label: '难度预设名称', group: '复现', description: '只是配置值，业务需要自行解释其含义' }),
    'test.notes': stringField('', { label: '测试备注', group: '复现', maxLength: 200 }),
    'debug.bounds': booleanField(false, { label: '显示边界', group: '调试', timing: '实时' }),
    'orders.rewards': jsonField<number[]>([60, 200, 500], { label: '订单奖励表', group: '订单',
        accepts: (value: ConfigValue): value is number[] => Array.isArray(value) && value.length === 3 &&
            value.every(item => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 10000) }),
};

/** 示例启动参数，测试工具开关由项目代码或测试构建设置决定。 */
export interface ExampleConfigOptions {
    allowTestTools: boolean;
    projectConfig?: ConfigDocument;
    url?: string;
    onPanelVisibilityChange?: (visible: boolean) => void;
}

/**
 * 示例启动入口：项目层 → 本地/链接 → 锁定重启参数 → 调试面板。
 * 创建后业务须通过 store.get 取值或订阅，系统不会自动改写现有常量、节点或刚体。
 */
export function createExampleConfig(options: ExampleConfigOptions) {
    const store = new ConfigStore({
        project: '通用玩法示例', version: 1, schema: EXAMPLE_SCHEMA,
        validate: values => values['launch.minSpeed'] <= values['launch.maxSpeed'] ? [] : ['最小发射速度不能大于最大速度'],
    });
    if (options.projectConfig) store.importDocument(options.projectConfig, '项目');
    const session = new ConfigTestSession(store, { enabled: options.allowTestTools, url: options.url });
    const warnings = session.restore();
    for (const warning of warnings) console.warn('测试配置：' + warning);
    store.start();
    const panel = new ConfigDebugPanel(session, { onVisibilityChange: options.onPanelVisibilityChange });
    panel.mount();
    return { store, session, panel, warnings,
        /** 游戏入口销毁时清理面板，业务自行释放其 subscribe 返回的解绑函数。 */
        dispose(): void { panel.dispose(); },
    };
}
