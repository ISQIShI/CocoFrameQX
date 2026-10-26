# 通用玩法配置系统

面向 PA 项目的快速实现和调试：程序声明参数与约束，测试人员在 Web 测试包中修改、保存、导入导出和分享配置。无需后端服务，无需为调参重写游戏常量或每次重新打包。

本模块独立于具体玩法，ConfigExample 只展示调用方式，不会自动接入或修改场景。各项目在业务目录声明自己的参数和组件适配器，示例数值不代表项目策划规则。

兼容性维护（2026-10-26）：兼容 Creator 默认 ES2015 声明库及 isolatedModules；数组成员检查使用 indexOf，未知 JSON 输入先单独判断 null，确保 strict 开关两种模式都能编译。业务不得通过提高检查工具的目标库掩盖实际工程诊断。

## 1. 文件与职责

| 文件 | 职责 |
| --- | --- |
| ConfigTypes.ts | 字段声明、类型推导、配置文件格式、中文校验错误 |
| ConfigStore.ts | 默认值与分层覆盖、整批校验、只读快照、变更订阅、生效时机 |
| ConfigTestSession.ts | 测试开关、本地保存/恢复、URL 复现、缓存隔离 |
| ConfigDebugPanel.ts | 独立 Web 面板，自动生成控件、搜索、JSON 文件交互 |
| CocosConfigLoader.ts | 可选的 JsonAsset / resources 项目配置加载 |
| ConfigExample.ts | 可运行的声明和启动示例，不自动注册、不修改现有游戏 |
| index.ts | 核心及 Web 工具出口；引擎加载器使用独立导入 |

核心不依赖 cc，不创建全局单例，也不依赖 ServiceLocator。项目可导出自己的容器实例，或把实例登记到已有服务定位器，避免多个入口重复创建。

## 2. 优先级与生效时机

优先级从低到高：

```text
字段声明默认值 < 项目配置文件 < 本地保存配置 < 本次会话（链接、面板、导入）
```

字段键采用 `launch.minSpeed` 等稳定字符串，点号只作命名，不会按路径修改其他对象。数字、开关、文本、选项及经过业务校验的 JSON 表格都可使用。数组和对象字段整体替换，不按下标拼接；缺省字段继承低优先级，0、false、空文本均为合法覆盖，null 不代表删除。

| 时机 | 行为 | 适用 |
| --- | --- | --- |
| 实时 | 应用成功后更新当前值并通知订阅者 | 下一次发射速度、效果开关、音量等能明确响应变化的参数 |
| 重启 | 启动前正常应用；start 后只更新目标值，当前局保持原值 | 重力初始化、场地尺寸、初始数量、随机种子、关卡表 |

默认是“重启”。`store.start()` 表示配置启动阶段结束，不是启动游戏的引擎指令。它不能再次调用来让待重启项生效；需要新建容器并重新执行游戏初始化。网页测试通常先保存再刷新，或用生成的链接重新打开。配置系统不为现有游戏增加重开按钮。

**实时仅代表容器里的值更新。** 业务需要在使用点调用 `get`，或订阅后按自己的安全时点更新缓存/表现。系统不会自动查找节点、修改刚体或改写已有 GAME_CONFIG 常量。持有旧快照或启动时解构出的数值不会自动改变。

全部字段、目标配置的跨字段规则、当前运行组合的跨字段规则均通过后才提交。任何错误使整次更新不生效。若一个实时字段与一个待重启字段必须一起变更，建议将整组设为“重启”，避免出现本局非法组合。

## 3. 最快接入

先用示例确认操作方式。在项目自己的入口中调用一次：

```typescript
import { createExampleConfig } from './CocoFrameQX/Config/ConfigExample';

// 由项目明确决定：测试包可以为 true，普通发布包设为 false。
// 不要让 URL 自己决定是否允许打开测试工具。
const tuning = createExampleConfig({
    allowTestTools: true,
    onPanelVisibilityChange: visible => {
        // 给现有输入系统添加或移除“配置面板”暂停原因。
        // 不要在关闭面板时清除后台、结束等其他暂停原因。
        console.log(visible ? '配置面板已打开' : '配置面板已关闭');
    },
});

// 后续业务使用时读取；这里仅展示读取，不改变 AnimalMerge。
const nextShotSpeed = tuning.store.get('launch.minSpeed');
console.log('下一发速度', nextShotSpeed);

// 若业务确实需要主动响应变化，保留解绑函数。
const unsubscribe = tuning.store.subscribe(snapshot => {
    console.log('当前速度', snapshot.active['launch.minSpeed']);
    console.log('待重启字段', snapshot.pendingRestart);
});

// 项目入口销毁时调用。
unsubscribe();
tuning.dispose();
```

上例最后两行是退出阶段示意，实际项目中应放在 onDestroy，而不是启动后立即执行。首次启动允许面板时右上角出现“参数”入口；URL 中添加 `qxConfig=1` 可直接展开面板。此参数只控制显示，不绕过项目的调试开关。

要定义自己的参数：

```typescript
import { ConfigStore, numberField, booleanField, choiceField } from './CocoFrameQX/Config';

const config = new ConfigStore({
    project: '项目唯一标识',
    version: 1,
    schema: {
        'launch.min': numberField(10, { label: '最低速度', group: '发射', min: 1, max: 80, timing: '实时' }),
        'launch.max': numberField(25, { label: '最高速度', group: '发射', min: 1, max: 80, timing: '实时' }),
        'debug.bounds': booleanField(false, { label: '显示边界', timing: '实时' }),
        'level.mode': choiceField('普通', ['普通', '简单'] as const, { label: '关卡模式' }),
    },
    validate: values => values['launch.min'] <= values['launch.max'] ? [] : ['最低速度不能超过最高速度'],
});

config.get('launch.min'); // 推导为 number。
config.get('level.mode'); // 选项使用 as const，可保留字符串联合类型。
```

复杂表格使用 `jsonField<T>(默认值, { label, accepts })`，accepts 必须为类型守卫，验证行数、字段、范围和业务关系；不要仅返回 true。字段及跨字段校验函数必须是纯检查，不在校验中修改容器、引擎对象或触发外部行为。数字不接受数值字符串、NaN 或 Infinity。所有对外快照递归冻结，不能通过数组 push 等方式绕开配置更新。

## 4. Cocos 项目配置与启动顺序

项目层文件与调试导入文件使用同一格式。示例：

```json
{
  "format": 1,
  "project": "通用玩法示例",
  "version": 1,
  "values": {
    "launch.minSpeed": 12,
    "launch.maxSpeed": 28,
    "physics.gravity": -14
  }
}
```

将需要随包携带的项目文件交给 Cocos 正常导入，可作为 JsonAsset 引用，或放到 `assets/resources/config/玩法.json`。上面的 project、version、字段键必须与项目自己的声明一致。这里展示路径约定，不自动创建或替换项目资源。

```typescript
import { ConfigTestSession, ConfigDebugPanel } from './CocoFrameQX/Config';
import { loadProjectConfig } from './CocoFrameQX/Config/CocosConfigLoader';

// config 是上一节创建的容器。
// 这段流程应在唯一游戏入口显式等待，不依赖不同组件 start 的执行顺序。
await loadProjectConfig(config, 'config/玩法', 5000);
const session = new ConfigTestSession(config, { enabled: true });
const warnings = session.restore();
warnings.forEach(text => console.warn(text));
config.start();
const panel = new ConfigDebugPanel(session);
panel.mount();
// 现在才创建刚体、场地、关卡等实际游戏对象。
```

如果已通过 Inspector 得到 JsonAsset，可用 `applyProjectConfig(config, jsonAsset)`，无需异步加载。没有项目 JSON 时可直接使用声明默认值。

Cocos 不会因为某个组件的 start 返回 Promise 就自动等待所有其他组件。游戏主入口必须集中控制加载、恢复和游戏创建。加载失败/超时会拒绝 Promise，调用方决定显示错误或明确使用默认值；迟到回调不再写配置。不要在已经运行的局中重新加载项目资源来偷偷改变初始化参数。

初始化顺序固定为：创建容器 → 应用项目层 → 恢复本地与链接 → start → 创建实际游戏 → 可选面板。无效本地/链接文件返回中文告警并保留上一有效配置，不删除旧文件，便于定位问题。

## 5. 策划在测试包中的操作

1. 打开程序提供的 Web 测试包地址，点击右上角“参数”。使用 HTTP/HTTPS 测试服务；直接双击 file:// 页面不是推荐的 Cocos Web 包运行方式。
2. 搜索字段，修改数值，点击“应用参数”。面板会显示来源、约束、实际仍在使用的值及待重启数量。
3. 实时字段按业务接入逻辑生效；重启字段需先“保存到本机”，再刷新整个测试页面。
4. “导出 JSON”输出可复制文本，“下载 JSON”生成文件；另一台设备可粘贴文本或选择 JSON 文件导入。
5. “生成复现链接”携带完整目标配置，可复制给程序或其他测试人员。配置过大时改传 JSON。
6. “恢复项目参数”清除本地/本次覆盖，保留包内项目层；它不立即重建当前局。若地址仍带 qxValues，需要移除该参数或换新链接，否则下次打开还会加载链接覆盖。

“保存、导出、下载、生成链接”都会先校验并应用面板当前输入；无效输入阻止该动作。单独“导入 JSON”使用文本框/文件内容。外部代码提交新版本时面板重建控件，未应用的面板草稿会被新配置覆盖。

保存导出的是**完整目标值**，因此适合复现，也会固定当前版本的默认值。项目调整字段语义、结构或不希望旧默认值继续覆盖时，应递增 version；旧版本文件和缓存不会自动迁移。新版本仍需兼容旧值时，业务显式迁移后再导入。

本地缓存按项目标识和版本隔离，保存在当前浏览器/来源，换浏览器、域名、端口或清理网站数据可能不再出现。存储被禁用或配额不足时明确提示，仍可本次调参和导出。退出后不会自动保存，避免临时试验影响之后的测试。

复现链接保留其他查询参数和片段标识；长度限制为 8000 字符，配置文本导入上限为 64K 字符。分享的是配置，不是存档；随机种子只有在业务随机源实际使用该字段时才有作用，也不保证物理求解跨设备完全一致。

## 6. 测试包与正式发布边界

- 由项目显式传入 `enabled / allowTestTools`。关闭后不读取测试缓存或 URL，不创建面板，不提供保存、清除和分享操作；正常项目配置照常使用。
- 测试工具不请求远端配置，配置字符串仅作为数据解析。
- 核心适用于 Web、原生及纯逻辑测试。Web 面板依赖 DOM、Shadow DOM 和文件下载能力；原生/无 DOM 环境不会创建它，可复用 ConfigStore 与 ConfigTestSession 的存储接口，另接项目自己的 Cocos UI。
- 可将 `sys.localStorage` 通过 options.storage 传入测试会话；存储访问仍经过同样的错误处理。不给 URL 时原生环境不支持链接分享。
- UI 内的触摸、鼠标和键盘事件会停止冒泡。若项目在 window/document 捕获阶段监听输入，必须使用 onVisibilityChange 协调输入暂停；不能假定 DOM 冒泡拦截能覆盖所有第三方输入实现。
- 加载器只使用正常的 JsonAsset / resources API，不改 Cocos 引擎、打包器或现有框架服务。测试包是否把调试工具剔除由项目构建策略决定，关闭开关是运行行为控制。

## 7. 常用维护 API

| 操作 | API |
| --- | --- |
| 读取当前生效值 | `store.get(key)` |
| 查看目标、来源与待重启字段 | `store.snapshot()` |
| 合并少量测试覆盖 | `store.patchLayer('会话', { 'launch.min': 12 })` |
| 替换覆盖层，空对象撤销 | `store.replaceLayer('会话', {})` |
| 同时替换多层，保证原子性 | `store.replaceLayers({ 本地: {}, 会话: {} })` |
| 文件导入/导出 | `store.importDocument(json)` / `store.exportJSON()` |
| 观察成功提交 | `store.subscribe(listener)`，返回解绑函数 |
| 保存、恢复、重置、分享 | `session.save / restore / reset / shareURL` |
| 清理 Web 面板 | `panel.dispose()` |

监听异常不回滚已提交配置，也不阻断其他观察者。通知中同步改写配置会报错，避免递归通知和前后版本混乱；需要连带更新时，应在提交前一起计算，或在业务下一次更新时发起新事务。无需修改业务规则的联动优先通过读取同一快照完成。

## 8. 验证与开发工具

开发测试位于工程根 `tools/coco-frame-qx/`，不在 assets 中。使用本项目生成的 temp 引擎声明及对应 TypeScript，不额外安装游戏运行依赖。

```text
node tools/coco-frame-qx/config.test.cjs
```

当前包含 21 项核心/存储/加载器检查，以及严格类型检查和错误类型调用样例。检查覆盖覆盖顺序、非法输入不部分提交、实时/重启关系、只读性、监听、JSON 身份版本、缓存权限、URL 复现与迟到回调。

可选浏览器测试需要本机已有 Playwright 与兼容浏览器：

```text
node tools/coco-frame-qx/config-panel.test.cjs <Playwright模块绝对路径> <浏览器可执行文件绝对路径>
```

该测试使用独立无头浏览器和内存网页，验证编辑、JSON、下载、保存恢复、搜索、窄屏、输入隔离与销毁，不启动真实游戏或访问远端服务。验证结果与未覆盖范围应在每次交付中如实说明；本模块接入具体项目后仍需少量真实场景核对。

2026-10-26 交付验证：严格类型检查无诊断，21 项核心/存储/加载检查通过；独立无头 Edge 的 5 组面板检查通过，包含 375×667 窄屏和点击隔离。未运行真实 Cocos Preview、实际打包产物或原生包；当前玩法尚未迁移到本系统。
