import { ConfigValue } from './ConfigTypes';
import { bool, choice, color, json, num, text } from './ConfigBuilder';
import { defineConfig, group } from './ConfigDefinition';

/** 校验订单奖励表：三项非负整数。 */
function isRewardTable(value: ConfigValue): value is number[] {
    return Array.isArray(value) && value.length === 3 &&
        value.every(item => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 10000);
}

/** 可运行的通用声明示例；仅展示接入方式，不连接 AnimalMerge 或修改其规则。 */
export const EXAMPLE_CONFIG = defineConfig({
    launch: group('发射', {
        minSpeed: num(10).label('最小发射速度').range(0.1, 100).step(0.5).live(),
        maxSpeed: num(25).label('最大发射速度').range(0.1, 100).step(0.5).live(),
        cooldown: num(0.2).label('发射间隔').range(0, 5).step(0.05).live().describe('单位秒；游戏应在下一次发射时读取'),
    }),
    physics: group('物理', {
        gravity: num(-14).label('世界重力').range(-50, -0.1),
    }),
    test: group('复现', {
        seed: num(12345).label('测试随机种子').range(0, 2147483647).int(),
        difficulty: choice('普通', ['简单', '普通', '困难'] as const).label('难度预设名称').describe('只是配置值，业务需要自行解释其含义'),
        notes: text('').label('测试备注').maxLength(200),
    }),
    debug: group('调试', {
        bounds: bool(false).label('显示边界').live(),
        boundsColor: color([255, 80, 80, 255]).label('边界颜色').live(),
    }),
    orders: group('订单', {
        rewards: json<number[]>([60, 200, 500], isRewardTable).label('订单奖励表'),
    }),
});

/** 示例启动参数，测试工具开关由项目代码或测试构建设置决定。 */
export interface ExampleConfigOptions {
    allowTestTools: boolean;
    projectConfig?: unknown;
    url?: string;
    onPanelVisibilityChange?: (visible: boolean) => void;
}

/**
 * 示例启动入口：一条链完成项目层 → 本地/链接 → 锁定重启参数 → 接入定义，再挂载面板。
 * 业务通过 EXAMPLE_CONFIG.values 读取；系统不会自动改写现有常量、节点或刚体。
 */
export function createExampleConfig(options: ExampleConfigOptions) {
    const runtime = EXAMPLE_CONFIG.setup('通用玩法示例', 1)
        .validate(v => v.launch.minSpeed <= v.launch.maxSpeed ? [] : ['最小发射速度不能大于最大速度'])
        .projectDocument(options.projectConfig)
        .testTools({ enabled: options.allowTestTools, url: options.url, onPanelVisibilityChange: options.onPanelVisibilityChange })
        .start();
    for (const warning of runtime.warnings) console.warn('测试配置：' + warning);
    runtime.panel.mount();
    return runtime;
}
