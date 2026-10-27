# 通用玩法配置系统

面向 PA 项目的快速实现和调试：程序在一处声明参数与约束，测试人员在 Web 测试包中修改、保存、导入导出和分享配置。无需后端服务，无需为调参重写游戏常量或每次重新打包。

本模块独立于具体玩法，ConfigExample 只展示调用方式，不会自动接入或修改场景。各项目在业务目录声明自己的参数和组件绑定，示例数值不代表项目策划规则。

兼容性：兼容 Creator 默认 ES2015 声明库及 isolatedModules；strict 开关开启或关闭都能编译。核心不依赖 `cc`，不创建全局单例。

2026-10-27 重构：新增链式字段构建器、嵌套定义与类型化读取视图、链式启动和组件绑定器；面板只提交改动并按分组折叠；保存与分享只携带改动，文档宽松导入并支持版本迁移；实时与重启参数组合非法时整体推迟到重启。旧的 `numberField` 等工厂与 `new ConfigStore` 用法继续有效。

## 1. 文件与职责

| 文件 | 职责 |
| --- | --- |
| ConfigTypes.ts | 字段声明、类型推导、文档格式、更新结果、中文校验错误 |
| ConfigBuilder.ts | 链式字段构建器：`num / bool / text / choice / json / vec / color` |
| ConfigDefinition.ts | `defineConfig / group`：嵌套定义 → 扁平配置表、默认值和类型化读取视图 |
| ConfigSetup.ts | `definition.setup(...)…start()` 链式启动，返回 `ConfigRuntime` |
| ConfigBinder.ts | 把现有组件属性登记为配置字段，启动时写入、退出时恢复 |
| ConfigStore.ts | 默认值与分层覆盖、整批校验、只读快照、变更订阅、生效时机、文档导入导出 |
| ConfigTestSession.ts | 测试开关、本地保存/恢复、URL 复现、缓存隔离 |
| ConfigDebugPanel.ts | 独立 Web 面板，按分组生成控件、搜索、JSON 文件交互 |
| CocosConfigLoader.ts | 可选的 JsonAsset / resources 项目配置加载 |
| ConfigExample.ts | 可运行的声明和启动示例 |
| index.ts | 核心及 Web 工具出口；引擎加载器使用独立导入 |

## 2. 最快接入：一处声明、一条链启动

```typescript
import { defineConfig, group, num, bool, choice, color } from './CocoFrameQX/Config';

export const GAME = defineConfig({
    launch: group('发射', {
        minSpeed: num(12).label('最小发射速度').range(0.1, 100).live(),
        maxSpeed: num(28).label('最大发射速度').range(0.1, 100).live(),
        cooldown: num(0.2).label('发射冷却').range(0, 5).step(0.05).live().describe('单位秒'),
    }),
    physics: group('物理', {
        gravity: num(-14).label('重力').range(-100, -0.1),          // 默认“重启”生效
        substeps: num(6).label('每帧最大物理步数').range(1, 30).int(),
    }),
    debug: group('调试', {
        bounds: bool(false).label('显示边界').live(),
        tint: color([255, 80, 80, 255]).label('边界颜色').live(),
        mode: choice('普通', ['普通', '简单'] as const).label('模式'),
    }),
}, { timingNotes: { 重启: '保存后重新打开页面生效' } });

// 业务读取：带类型、只读；未启动时为声明默认值。
GAME.values.launch.minSpeed;   // number
GAME.values.debug.mode;        // '普通' | '简单'
GAME.values.debug.tint;        // readonly number[]
```

```typescript
// 唯一游戏入口，在创建刚体、场地等实际对象之前调用。
const runtime = GAME.setup('项目唯一标识', 1)
    .validate(v => v.launch.minSpeed <= v.launch.maxSpeed ? [] : ['最小发射速度不能大于最大速度'])
    .projectDocument(projectJsonAsset?.json)          // 可选，包内项目层
    .testTools({ enabled: 测试包, onPanelVisibilityChange: visible => 暂停或恢复输入(visible) })
    .onChange(snapshot => { if (snapshot.changed.indexOf('debug.bounds') !== -1) 刷新边界(); })
    .start();
runtime.warnings.forEach(text => console.warn(text));
runtime.panel.mount();          // 游戏就绪后再挂载面板
// onDestroy：runtime.dispose();  幂等，读取视图回到默认值，扩展写入的组件值被恢复
```

- 字段方法：`label` 标题（省略时用键名）、`describe` 说明、`live` 实时 / `restart` 重启（默认）、数值与向量的 `range / min / max / int / step`、文本的 `maxLength`。
- `group(标题, 子项)` 成为面板分组，多层以“·”连接（如“动物物理·小鸡”）；普通嵌套对象只扩展键路径。键名不能含点号。
- 扁平键由路径拼接，如 `launch.minSpeed`、`animals.1.radius`；JSON、面板、`store.get` 都使用扁平键。
- 子组可以由程序生成，例如按等级循环创建 `group(名称, {...})` 放入 `Record<string, …>`，读取时 `values.animals[level].radius`。
- 跨字段校验函数收到嵌套值 `v` 与全部扁平值 `flat`（含扩展字段），返回中文问题列表；必须是纯检查。
- `start()` 的固定顺序：创建容器 → 项目层 → 本地与链接 → 锁定重启参数 → 接入定义 → 应用扩展 → 订阅。任一步失败会撤销已完成的接入后抛出。
- 同一定义同一时刻只能接入一个运行容器；第二个入口启动会报错，不会污染当前值。

## 3. 绑定现有组件属性

场景里已有组件的数值（引导线长度、布局坐标、碰撞器尺寸、颜色等）不必搬进声明，用绑定器登记：默认值取自组件当前值，启动后写入生效值，退出时恢复原值，不保存场景。

```typescript
const scene = new ConfigBinder({ description: '默认值取自当前场景', guard: target => isValid(target) });
scene.scope('scene.aim', '瞄准线')
    .value(aimGuide, 'length', '世界长度', { min: 0.1, max: 50 })
    .vector(aimGuide, 'color', ['r', 'g', 'b', 'a'], '颜色', { min: 0, max: 255 });
scene.scope('scene.board', '场地')
    .position(spawnAnchor, '发射点', { name: 'spawn' })
    .vector(groundCollider, 'size', ['x', 'y', 'z'], '地面碰撞尺寸', { min: 0.001, max: 1000 });

GAME.setup('项目', 1).extend(scene)…start();
```

- `value` 自动识别数值、开关、文本；`vector` 复制当前对象（优先 `clone()`）后整体赋值，触发引擎属性 setter；`position` 通过 `setPosition(x, y, z)` 写入；`custom` 登记任意字段与写入函数。
- `guard` 返回假时跳过写入，用于已销毁的组件。绑定默认“重启”生效：只在启动时写一次，不在运行中搬动物体。
- 自定义扩展只需实现 `{ schema, apply(store), restore() }`。

## 4. 优先级与生效时机

```text
字段声明默认值 < 项目配置文件 < 本地保存配置 < 本次会话（链接、面板、导入）
```

数组和对象字段整体替换，不按下标拼接；0、false、空文本均为合法覆盖，null 不代表删除。

| 时机 | 行为 | 适用 |
| --- | --- | --- |
| 实时 | 应用成功后更新当前值并通知订阅者 | 下一次发射速度、效果开关、音量等能明确响应变化的参数 |
| 重启 | 启动前正常应用；start 后只更新目标值，当前局保持原值 | 重力初始化、场地尺寸、初始数量、随机种子、关卡表 |

**实时仅代表容器里的值更新。** 业务在使用点读取 `values`，或订阅后按 `snapshot.changed` 只处理变化的键。持有旧快照或启动时解构出的数值不会自动改变。

目标值的字段与跨字段规则必须通过，否则整次更新失败。启动后若“实时新值 + 本局重启旧值”的组合非法（例如同时提高速度上限〔重启〕和发射速度〔实时〕），本次改动**整体推迟到重启**：当前值不变，相关字段列入待重启，更新结果为 `{ changed: true, deferred: true }`，面板给出提示。

## 5. 保存、导入导出与版本

文档格式：

```json
{ "format": 1, "project": "项目唯一标识", "version": 1, "values": { "launch.minSpeed": 12 } }
```

- **保存到本机与复现链接只携带改动**：本地/会话层中相对“默认 + 项目层”真正不同的值。代码调整默认值后，未改动过该字段的测试者会自动用上新默认值。面板另有“导出全部”，用于生成完整的项目配置文件。
- **导入默认宽松**：未知键（字段改名或删除）和单字段非法值逐项跳过并返回中文提示，其余值照常导入；跨字段规则仍整批校验，失败则整份不导入。`importDocument(doc, 层, { strict: true })` 保留严格行为。
- **版本**：等于当前版本直接导入；低于当前版本先调用 `.migrate((values, fromVersion) => 新值)`，未提供迁移时按当前声明宽松导入并提示；高于当前版本或项目标识不符时拒绝。字段语义改变才需要递增 version，单纯增删字段不必递增。
- 本地缓存键为 `qx-config:<项目>`，不再按版本隔离；恢复时兼容读取旧的 `:v<版本>` 键，下次保存或清除时移除。

## 6. Cocos 项目配置文件

项目层文件可作为 JsonAsset 在 Inspector 引用，把 `asset.json` 交给 `.projectDocument()`；或放到 `assets/resources/config/` 后用 `loadProjectConfig(store, 'config/玩法')` 加载（需在 `store.start()` 之前，适用于直接使用 ConfigStore 的写法）。Cocos 不会等待组件 start 中的 Promise，异步加载必须由唯一入口显式等待。不要在运行中重新加载项目资源来偷偷改变初始化参数。

## 7. 策划在测试包中的操作

1. 打开 Web 测试包（HTTP/HTTPS），点击右上角“参数”。参数按分组折叠，可搜索标题、分组或参数键；搜索时自动展开命中分组。
2. 修改后点击“应用参数”，只提交改动过的字段，来源列显示每个值来自默认、项目、本地还是会话。没有改动时提示“没有改动”。
3. 实时字段按业务接入逻辑生效；重启字段需“保存到本机”后刷新页面。
4. “导出改动”“下载 JSON”输出相对项目参数的改动；“导出全部”输出完整目标值；导入支持粘贴文本或选择文件，跳过的内容会列在状态栏。
5. “生成复现链接”携带改动，可复制给程序或其他测试人员。配置过大时改传 JSON。
6. “恢复项目参数”清除本地/本次覆盖，保留包内项目层；它不立即重建当前局。若地址仍带 qxValues，需要移除该参数或换新链接。

外部代码提交新版本时面板重建控件，未应用的面板草稿会被新配置覆盖；用户折叠的分组保持折叠。本地缓存保存在当前浏览器/来源；存储被禁用或配额不足时明确提示，仍可本次调参和导出。复现链接长度上限 8000 字符，配置文本导入上限 64K 字符。分享的是配置，不是存档。

## 8. 测试包与正式发布边界

- 由项目显式传入 `testTools({ enabled })`。关闭后不读取测试缓存或 URL，不创建面板，不提供保存、清除和分享操作；项目配置照常使用。
- 测试工具不请求远端配置，配置字符串仅作为数据解析。
- 核心适用于 Web、原生及纯逻辑测试。Web 面板依赖 DOM、Shadow DOM 和文件下载能力；原生/无 DOM 环境不会创建它。可将 `sys.localStorage` 通过 `storage` 传入。
- 面板内的触摸、鼠标和键盘事件停止冒泡。若项目在 window/document 捕获阶段监听输入，必须用 `onPanelVisibilityChange` 协调输入暂停。

## 9. 常用 API

| 操作 | API |
| --- | --- |
| 读取当前生效值 | `definition.values.组.键`，或 `store.get('组.键')` |
| 查看目标、来源、待重启与本次变化 | `store.snapshot()` |
| 合并少量覆盖 | `store.patchLayer('会话', { 'launch.minSpeed': 12 })`，返回 `{ changed, deferred }` |
| 替换覆盖层，空对象撤销 | `store.replaceLayer('会话', {})` / `store.replaceLayers({ 本地: {}, 会话: {} })` |
| 导入 / 导出 | `store.importDocument(json)` 返回跳过提示；`store.exportJSON('改动' 或 '全部')` |
| 观察成功提交 | `store.subscribe(listener)` 或 `setup.onChange(listener)` |
| 保存、恢复、重置、分享 | `session.save / restore / reset / shareURL` |
| 释放 | `runtime.dispose()` |

监听异常不回滚已提交配置，也不阻断其他观察者。通知中同步改写配置会报错；需要连带更新时，应在提交前一起计算，或在业务下一次更新时发起新事务。

新增字段类型时，在 `ConfigStore.ts` 的 `KIND_CHECKS` 与面板的 `control` 各加一项，并在 ConfigTypes 中声明字段接口。

## 10. 验证与开发工具

开发测试位于工程根 `tools/coco-frame-qx/`，不在 assets 中，使用本项目生成的 temp 引擎声明及对应 TypeScript。

```text
node tools/coco-frame-qx/config.test.cjs
node tools/coco-frame-qx/config-panel.test.cjs <Playwright模块绝对路径> <浏览器可执行文件绝对路径>
```

第一条包含严格类型检查（含嵌套定义推导和错误键的编译期断言）与 28 项核心、构建器、链式启动、绑定器、存储和加载器检查；第二条用独立无头浏览器和内存网页验证 6 组面板行为。

2026-10-27 交付验证：严格及项目实际非严格类型检查无诊断；28 项核心检查与 6 组无头 Edge 面板检查通过；AnimalMerge 已迁移到本系统并通过其 63 项逻辑及 3 组面板检查。未运行真实 Cocos Preview、实际打包产物或原生包。
