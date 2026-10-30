# 通用玩法配置系统

面向 PA 项目的快速实现和调试：程序在一处声明参数与约束，测试人员在 Web 测试包中修改、保存、导入导出和分享配置。无需后端服务，无需为调参重写游戏常量或每次重新打包。

分为两部分：**配置核心**（本目录）可独立作为项目配置管理模块使用——声明、分层、校验、迁移、项目 JSON 导入导出、场景绑定与类型化读取；**调试工具**（`Tools/`）在核心之上提供本地保存、链接复现与 Web 面板，通过插件接口按需接入。依赖方向只有“工具 → 核心”。

本模块独立于具体玩法，不会自动接入或修改场景。各项目在业务目录声明自己的参数和组件绑定，下文示例数值不代表项目策划规则。

编译环境：Creator 默认 ES2015 声明库及 isolatedModules；strict 开关开启或关闭都能编译。除可选的 CocosConfigLoader 外不依赖 `cc`，不创建全局单例。

唯一接入方式：用链式构建器与 `defineConfig` 声明参数，用 `definition.setup(...)…start()` 启动，用 `definition.values` 读取。`ConfigStore` 是内部核心，由启动链创建。附加功能用 `.use(插件)` 接入。

## 1. 文件与职责

| 文件 | 职责 |
| --- | --- |
| ConfigTypes.ts | 字段声明、类型推导、文档格式、更新结果、中文校验错误 |
| ConfigBuilder.ts | 链式字段构建器：`num / bool / text / choice / json / vec / color` |
| ConfigDefinition.ts | `defineConfig / group`：嵌套定义 → 扁平配置表、默认值和类型化读取视图 |
| ConfigSetup.ts | `definition.setup(...)…start()` 链式启动，返回 `ConfigRuntime`；定义扩展 `ConfigExtension` 与插件 `ConfigPlugin` 接口 |
| ConfigBinder.ts | 把现有组件属性登记为配置字段，启动时写入、退出时恢复 |
| ConfigStore.ts | 默认值与分层覆盖、整批校验、只读快照、变更订阅、生效时机、文档导入导出 |
| CocosConfigLoader.ts | 可选：`loadConfigDocument` 从 resources 异步加载项目配置文档 |
| index.ts | 核心出口（不含调试工具）；引擎加载器使用独立导入 |
| Tools/ConfigTestSession.ts | 调试工具：本地保存/恢复、URL 复现、缓存隔离 |
| Tools/ConfigDebugPanel.ts | 调试工具：Web 面板（浅色主题，宽屏右侧抽屉、窄屏底部面板，逐级分组、搜索、统一应用，导入导出独立页） |
| Tools/ConfigTestTools.ts | 调试工具：把测试会话与面板接入启动流程的插件 |
| Tools/index.ts | 调试工具出口 |

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
// 只用配置核心：唯一游戏入口，在创建刚体、场地等实际对象之前调用。
const runtime = GAME.setup('项目唯一标识', 1)
    .validate(v => v.launch.minSpeed <= v.launch.maxSpeed ? [] : ['最小发射速度不能大于最大速度'])
    .projectDocument(projectJsonAsset?.json)          // 可选，包内项目层
    .onChange(snapshot => { if (snapshot.changed.indexOf('debug.bounds') !== -1) 刷新边界(); })
    .start();
runtime.warnings.forEach(text => console.warn(text));
// onDestroy：runtime.dispose();  幂等，读取视图回到默认值，扩展写入的组件值被恢复，插件被释放
```

```typescript
// 测试包再接入调试工具：由入口按开关创建插件，核心不感知。
import { ConfigTestTools } from './CocoFrameQX/Config/Tools';

const tools = 测试包 ? new ConfigTestTools({ panel: { onVisibilityChange: visible => 暂停或恢复输入(visible) } }) : null;
const runtime = GAME.setup('项目唯一标识', 1).projectDocument(projectJsonAsset?.json).use(tools).start();
tools?.mount();                 // 游戏就绪后挂载面板；无 DOM 时返回 false
tools?.session?.save();         // 会话与面板在启动后可用（panel: false 时只有会话）
```

- 字段方法：`label` 标题（省略时用键名）、`describe` 说明、`live` 实时 / `restart` 重启（默认）、`unit` 显示单位、`showWhen(值 => 布尔)` 面板显示条件、数值与向量的 `range / min / max / int / step`、文本的 `maxLength`。
- `showWhen(v => v['debug.bounds'] === true)`：参数为以扁平键索引的当前值（面板中含可读的未应用输入），返回 true 时才在面板显示；多次调用须全部满足，只影响面板，不影响取值、校验与导出。分组也可用 `showWhen`，与组内字段条件同时满足。函数抛出异常时按显示处理；拼错键不会在声明期报错，需自行留意。
- 分组是与字段同类的定义节点：`group({ … }).label(标题).describe(说明).live()`，或简写 `group(标题, { … })`；省略标题时用键名。分组上的 `live()/restart()` 是组内默认生效时机，字段或更近的分组自行声明时优先。
- 分组身份与层级取自它在定义树中的**键路径**（如 `animals.1`），标题只用于显示，可含任意字符、可与其他分组同名；字段的 `group` 存所属分组键路径。普通嵌套对象只扩展键路径、不形成分组。键名不能含点号。
- `definition.groups` 列出分组（键、标题、说明）；容器 `store.groups()` 另带 `parent`（键路径前缀中最近的分组），面板目录据此建立。分组只是显示元数据，不参与取值、分层与导出。
- 扁平键由路径拼接，如 `launch.minSpeed`、`animals.1.radius`；JSON、面板、`store.get` 都使用扁平键。
- 子组可以由程序生成，例如按等级循环创建 `group(名称, {...})` 放入 `Record<string, …>`，读取时 `values.animals[level].radius`；面板中按 `animals.<等级>` 区分，同名也不会合并。
- 跨字段校验函数收到嵌套值 `v` 与全部扁平值 `flat`（含扩展字段），返回中文问题列表；必须是纯检查。问题可写成 `configIssue('最小发射速度不能大于最大速度', 'launch.minSpeed', 'launch.maxSpeed')`，面板会在输入时把它显示在这些参数旁；纯文本问题只在底部汇总。
- `start()` 的固定顺序：合并字段 → 创建容器 → 项目层 → 各插件 `beforeStart`（如恢复本地与链接） → 锁定重启参数 → 接入定义 → 应用扩展 → 订阅 → 各插件 `afterStart`（如创建面板）。任一步失败会撤销已完成的接入（含已启动插件的 `dispose`）后抛出。
- 插件 `ConfigPlugin { beforeStart?(store), afterStart?(store), dispose?() }`：`beforeStart` 可写本地或会话层并返回提示（并入 `runtime.warnings`），`dispose` 在释放时按注册逆序调用。`.use(null)` 被忽略，便于按开关传入。扩展（如绑定器）负责“补充字段并写入目标”，插件负责“在启动流程中附加行为”。
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
- `scope(前缀, 标题, 说明?)` 以前缀为身份登记分组，同一前缀再次使用时标题必须一致；子作用域 `scope(名称, 标题?)` 给出标题时成为子分组，省略时字段仍归入当前分组（适合多个实例共用一组，如 `scope('scene.cards', '订单实例').scope(String(i))`）。键路径位于某分组之下的作用域自动成为其子分组。
- `guard` 返回假时跳过写入，用于已销毁的组件。绑定默认“重启”生效：只在启动时写一次，不在运行中搬动物体。
- 自定义扩展只需实现 `{ schema, apply(store), restore() }`，可选 `groups` 补充分组（与定义同键时标题须一致）；可选 `update(store, changed)` 在启动后生效值变化时调用（先于 `onChange`）。`ConfigBinder` 借此在实时绑定字段变化时只重写变化项。

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

- **保存到本机与复现链接只携带改动**：本地/会话层中相对“默认 + 项目层”真正不同的值。代码调整默认值后，未改动过该字段的测试者会自动用上新默认值。生成或合并项目配置文件用 `exportDocument('非默认')`（面板“项目配置”）：项目层与本地/会话层中所有不同于声明默认值的目标值，未改字段继续跟随代码默认值；`'全部'` 输出每个字段的完整目标值。
- **导入宽松**：未知键（字段改名或删除）和单字段非法值逐项跳过并返回中文提示，其余值照常导入；跨字段规则仍整批校验，失败则整份不导入。
- **版本**：等于当前版本直接导入；低于当前版本先调用 `.migrate((values, fromVersion) => 新值)`，未提供迁移时按当前声明宽松导入并提示；高于当前版本或项目标识不符时拒绝。字段语义改变才需要递增 version，单纯增删字段不必递增。
- 本地缓存键为 `qx-config:<项目>`，不按版本隔离；版本差异由文档中的 version 与迁移处理。

## 6. Cocos 项目配置文件

项目层文件可作为 JsonAsset 在 Inspector 引用，把 `asset.json` 交给 `.projectDocument()`；或放到 `assets/resources/config/` 后用 `const doc = await loadConfigDocument('config/玩法')` 加载，再 `.projectDocument(doc).start()`。Cocos 不会等待组件 start 中的 Promise，异步加载必须由唯一入口显式等待。不要在运行中重新加载项目资源来偷偷改变初始化参数。

## 7. 策划在测试包中的操作

1. 打开 Web 测试包（HTTP/HTTPS），点击右上角“测试参数”。从分组目录逐级进入末级分组，或直接搜索标题、分组或参数键；分组页可用上一组/下一组在同级之间切换。
2. 修改后点击底部“应用 N 项改动”，只提交改动过的字段；每行标出值来自默认、项目、本地还是会话。没有改动时提示“没有改动”。
3. 实时字段按业务接入逻辑生效；重启字段需“保存到本机”后刷新页面。
4. “导入导出”页先选导出范围（本次改动 `改动` / 项目配置 `非默认` / 全部参数 `全部`），文本框下方第一行“下载 JSON”“导出到文本框”按所选范围输出，“生成复现链接”固定为 `改动`（保存到本机同样）；第二行“从文件导入”“导入文本”“复制文本”，跳过的内容会列在状态栏。
   输入时面板即试算校验，越界或跨字段冲突以红字显示在相关参数行内。
5. “生成复现链接”携带改动，可复制给程序或其他测试人员。配置过大时改传 JSON。
6. “恢复项目参数”清除本地/本次覆盖，保留包内项目层；它不立即重建当前局。若地址仍带 qxValues，需要移除该参数或换新链接。

面板控件按声明一次创建；外部代码提交新版本时只刷新未修改的控件和行标记，未应用的面板输入保留。本地缓存保存在当前浏览器/来源；存储被禁用或配额不足时明确提示，仍可本次调参和导出。复现链接长度上限 8000 字符，配置文本导入上限 64K 字符。分享的是配置，不是存档。

## 8. 测试包与正式发布边界

- 是否接入由项目决定：正式版本不创建 `ConfigTestTools`（不 `.use`），核心不会读取测试缓存或 URL，不创建面板；项目配置照常使用。`ConfigTestSession` 创建即启用，也可不经插件直接搭配自定义界面使用。
- 测试工具不请求远端配置，配置字符串仅作为数据解析。
- 核心适用于 Web、原生及纯逻辑测试。Web 面板依赖 DOM、Shadow DOM 和文件下载能力；原生/无 DOM 环境不会创建它。可将 `sys.localStorage` 通过 `storage` 传入。
- 发布开销：不接入工具时运行时零开销（不构造会话或面板）。包体方面，Cocos 构建会把 `assets` 下全部脚本打入包体，不论是否被引用，因此 `Tools/` 始终在包内（三模块压缩后约 41.6 KB，gzip 约 14.7 KB），只移动创建代码无法剔除。需要剔除时可把 `Tools/` 设为 Asset Bundle，并在正式构建的 Bundle 配置中设为不输出，测试包运行时加载后再接入。
- 面板内的触摸、鼠标和键盘事件停止冒泡。若项目在 window/document 捕获阶段监听输入，必须用面板选项 `onVisibilityChange` 协调输入暂停。

## 9. 常用 API

| 操作 | API |
| --- | --- |
| 读取当前生效值 | `definition.values.组.键`；扩展字段用 `runtime.store.get('键')` |
| 查看目标、来源、待重启与本次变化 | `store.snapshot()` |
| 合并少量覆盖 | `store.patchLayer('会话', { 'launch.minSpeed': 12 })`，返回 `{ changed, deferred }` |
| 替换覆盖层，空对象撤销 | `store.replaceLayer('会话', {})` / `store.replaceLayers({ 本地: {}, 会话: {} })` |
| 导入 / 导出 | `store.importDocument(json)` 返回跳过提示；`store.exportJSON('改动' / '非默认' / '全部')` |
| 试算校验（不修改） | `store.check('会话', { 键: 值 })` 返回 `{ message, keys }[]`；提交失败的 `ConfigError.details` 同样带涉及键 |
| 观察成功提交 | `store.subscribe(listener)` 或 `setup.onChange(listener)` |
| 接入附加功能 | `setup.use(plugin)`；测试工具 `new ConfigTestTools(options)`，启动后 `tools.session / tools.panel / tools.mount()` |
| 保存、恢复、重置、分享（工具） | `tools.session.save / reset / shareURL`（恢复由插件在启动前完成） |
| 释放 | `runtime.dispose()` |

监听异常不回滚已提交配置，也不阻断其他观察者。通知中同步改写配置会报错；需要连带更新时，应在提交前一起计算，或在业务下一次更新时发起新事务。

新增字段类型时，在 `ConfigStore.ts` 的 `KIND_CHECKS` 与面板的 `control` 各加一项，并在 ConfigTypes 中声明字段接口。

## 10. 验证与开发工具

开发测试位于工程根 `tools/coco-frame-qx/`，不在 assets 中，使用本项目生成的 temp 引擎声明及对应 TypeScript。

```text
node tools/coco-frame-qx/config.test.cjs
node tools/coco-frame-qx/config-panel.test.cjs <Playwright模块绝对路径> <浏览器可执行文件绝对路径>
```

第一条包含严格类型检查（含嵌套定义推导和错误键的编译期断言）与 30 项核心、构建器、链式启动、插件、绑定器、存储和加载器检查（含“核心不引用工具、未接入工具时不访问存储与地址”）；第二条用独立无头浏览器和内存网页验证 6 组面板行为（含标签筛选、撤销、外部变化保留输入、宽窄屏布局、二次确认）。

2026-10-27 交付验证：严格及项目实际非严格类型检查无诊断；28 项核心检查与 6 组无头 Edge 面板检查通过；AnimalMerge 已迁移到本系统并通过其 63 项逻辑及 3 组面板检查。未运行真实 Cocos Preview、实际打包产物或原生包。
