# CocoFrameQX 框架指南

CocoFrameQX 是供 Cocos Creator 游戏复用的 TypeScript 模块集合，包含配置、服务生命周期、事件、音频、数据结构，以及相机、角色、物品、UI 和试玩广告接入组件。项目按需组合这些能力，不要求继承统一游戏基类或启用全部管理器。

本指南用于理解框架边界、选择模块和找到接入文档；具体 API、错误契约和迁移步骤以各模块文档及源码为准。当前宿主 Project2 使用 Creator 3.8.5，框架位于 `assets/scripts/CocoFrameQX`，作为独立 Git 子模块维护。宿主玩法代码放在相邻业务目录，框架通用模块不依赖 AnimalMerge。

## 1. 先按需求阅读

| 你的需求 | 推荐入口 |
| --- | --- |
| 第一次接入，决定如何创建和退出服务 | [接入流程](#4-接入流程) → [Service](Service/README.md) |
| 集中声明玩法参数，支持测试调参 | [Config](Config/README.md)，调试面板按需使用 `Config/Tools` |
| 模块间广播通知、管理监听生命周期 | [Event](Event/README.md) |
| 音乐、音效、混音、暂停与播放所有权 | [通用音频](Audio/AudioCore.md) |
| 帧队列、活动实体、优先任务、概率、位标记、邻域查询 | [DataStructure](DataStructure/README.md) |
| 跟随 / 镜头运动、角色移动、物品堆叠、UI 引导 | [场景组件导航](#3-场景组件与配套模块) |
| 试玩渠道适配、交互上报、下载或本地化 | [SDK 导航](#3-场景组件与配套模块)，先确认宿主平台提供的接口 |

## 2. 通用核心与基础模块

这些模块可按能力单独选用。表中明确区分纯逻辑入口与引擎适配；导入组件适配文件会引入 Cocos 依赖。

| 模块 | 用途与主要脚本 | 接入边界与导航 |
| --- | --- | --- |
| **Config** | 强类型字段构建、嵌套分组、分层覆盖、整批校验、实时 / 重启生效、场景属性绑定；Tools 提供 Web 面板、保存、JSON 与复现链接 | [README](Config/README.md)。核心从 `Config/index.ts` 导入，不依赖 cc；资源加载器单独导入 `CocosConfigLoader.ts`，测试工具从 `Config/Tools` 导入 |
| **Service** | `ServiceLocator` 管理显式工厂、类型化令牌、singleton / scoped / transient、父子作用域、异步就绪和释放所有权 | [README](Service/README.md)。核心从 `Service/index.ts` 导入；组件借用 / 创建从 `CocosServiceExtensions.ts` 导入 |
| **Event** | `EventCenter` 同步分发类型化事件；订阅句柄及 `EventScope` 管理监听所有权 | [README](Event/README.md)。核心从 `Event/index.ts` 导入；组件生命周期连接单独导入 `CocosExtension.ts` |
| **DataStructure** | RingDeque、DenseSet、StablePriorityQueue、WeightedTable、BitSet、SpatialHash2D | [README](DataStructure/README.md)。核心从 `DataStructure/index.ts` 导入；纯 TypeScript，选型、API 和边界逐个说明 |
| **Audio** | `AudioCore.ts` 管理资源直入的播放句柄、作用域、总线和预算。Cocos 运行时和 Bundle 提供者分别负责驱动声部与动态获取资源 | [音频说明](Audio/AudioCore.md) |
| **Delegate** | `MulticastDelegate` 将一组函数作为对象成员暴露，支持指定 target、增删与调用结果 | [源码](Delegate/MulticastDelegate.ts)。纯 TypeScript，适合局部回调；跨模块事件及订阅所有权优先看 Event |
| **DirectorSystem** | `IClip` 定义进入 / 更新 / 退出，`ClipRunner` 顺序执行片段；`CustomClip` 提供回调片段，`MoveClip` 提供节点移动片段 | [目录](DirectorSystem/)、[ClipRunner](DirectorSystem/ClipRunner.ts)。runner / interface / CustomClip 不依赖 cc，MoveClip 依赖 cc；宿主每帧调用 update，不会自行启动 |
| **Singleton** | `SingletonBase` 管理普通类实例；`ComponentSingletonBase` 管理组件实例、可选自动创建和常驻 | [目录](Singleton/)。普通类与组件生命周期不同；新增有场景作用域或可替换依赖的服务优先选择 Service |
| **Utils** | 数学、随机、位标志、节点变换、Tween、相机、群集运动及 Inspector 按钮工具 | [目录](Utils/)。按文件直接导入，如 [MathUtil](Utils/MathUtil.ts)、[RandomUtil](Utils/RandomUtil.ts)、[FlagUtil](Utils/FlagUtil.ts)、[NodeUtil](Utils/NodeUtil.ts)、[TweenUtil](Utils/TweenUtil.ts)、[CameraUtil](Utils/CameraUtil.ts)、[BoidUtil](Utils/BoidUtil.ts)、[InspectorButton](Utils/InspectorButton.ts)。多数工具依赖 cc，不将整个目录视为纯逻辑库 |

模块没有 README 时，导航直接指向目录或主要源码；新增模块说明后，应将本表入口更新为对应 README。

## 3. 场景组件与配套模块

以下模块通常需要将组件挂到节点、配置 Inspector 字段，或提供对应预制体、相机、碰撞器和平台环境。它们是可选能力，复制脚本不会自动完成场景配置。

| 模块 | 内容与用途 | 使用前的配置重点 / 导航 |
| --- | --- | --- |
| **Actor** | `Player/PlayerController` 的角色移动与输入；`Bag` 的物品堆叠和移动形变；`StackBender` 的世界空间堆叠弯曲 | [目录](Actor/)、[PlayerController](Actor/Player/PlayerController.ts)、[Bag](Actor/Bag.ts)、[StackBender](Actor/StackBender.ts)。角色控制器需要相机 / CharacterController；Bag 基于 ProductContainer，按实际堆叠结构配置 |
| **Building** | `DiTie`、`ColletDiTie`、`DiTieBase` 提供收集、计分、开关动画和触发接收物品的组件 | [目录](Building/DiTie/)。与 Bag / Product、碰撞触发和材质 / 动画配置配合，按建筑玩法选用 |
| **Camera** | `MainCamera` 提供主摄像机及横竖屏变化通知；`CameraFollow` 负责跟随；`CameraController1` 提供移动、缩放、旋转、聚焦与震屏 | [目录](Camera/)。绑定目标、Camera、跟随参数；同一节点的运动写入应由宿主协调，避免多个控制器同时争用 |
| **FloatingText** | `FloatingTextManager` 复用飘字节点；`FaceToCamera` 面向相机；`Label3D` 将文字生成三维显示所需纹理 | [目录](FloatingText/)。配置飘字预制体、相机和字体 / 材质；创建与归还节点成对管理 |
| **Global** | `GameManager` 是可选的试玩入口，装配 SDK、音频、暂停与屏幕适配；`ProductManager` 缓存产品实例；`GlobalPool` 提供 Vec3 / Quat 池 | [目录](Global/)。已有游戏入口时由该入口装配所需服务；临时数学对象 alloc / free 成对，不将归还对象继续作为持久状态使用 |
| **Map** | `MapRecorder` 记录并恢复指定根下节点的激活结构；`MapRecorderComponent` 提供可扩展记录列表及 Inspector 操作 | [目录](Map/)。以现有节点名称和层级为依据，不保存完整场景；节点结构变化后重新核对记录 |
| **Product** | `Product` 表现物品投掷 / 移动；`ProductContainer` 管理已到达堆叠与在途项；`Utils` 提供配套移动计算 | [目录](Product/)。配置容器、落点及产品组件；需要区分在途数量和已到达数量，Bag 可在其上扩展 |
| **SDK** | `PlayableSDK` 对接渠道生命周期、交互、下载、上报与音量；`PlayableReport` 提供阶段打点；`PlatformCheck` / `Internationalization` 提供平台和语言显示适配 | [目录](SDK/)。由项目入口对接真实宿主，按用户操作和业务阶段调用；资源路径、渠道全局对象和语言资源由项目提供 |
| **UI** | `JoyStick` 提供摇杆输入，`DragTip` 提供拖动提示，`UIFollower` 提供位置跟随，`GuideArrow` 提供箭头 / 引导线 | [目录](UI/)。配置 UITransform、目标和相机等引用；JoyStick / DragTip 与 GameManager 暂停入口耦合，接入独立入口时先核对依赖 |

`UI/GuideArrow/JianTou2D.ts` 当前引用框架外的 `Actor/PlayerActor/PlayerActor`，本仓库不含该目标。使用该脚本前需要在宿主提供对应类型或显式改造依赖；它不能直接作为独立模块编译。其他模块也应按其实际 import 链一起接入。

## 4. 接入流程

### 选择依赖与导入入口

1. 在 Creator 项目的脚本目录引入本仓库，保留现有脚本和资源 `.meta` 身份。使用子模块时先初始化到宿主记录的版本，再进行编辑。
2. 从模块文档选择最小能力集合。框架根目录没有统一 `index.ts`，不要写 `import ... from './CocoFrameQX'`；有 index 的模块走模块入口，其余直接导入文件。
3. 纯逻辑模块可用于业务模型与命令行测试；Cocos 适配器、节点组件和 Web 测试工具只在需要的入口显式导入。
4. 在项目自己的唯一启动入口完成配置、服务、事件、音频及 SDK 装配，再向业务对象传入所需实例。已有入口可直接承担这些职责，不必增加 GameManager。

### 在一个入口组合服务

下面演示同一个事件中心和关卡队列如何由入口建立并释放。它不依赖 cc，也不替代具体游戏启动逻辑。

```ts
import { ServiceLocator, createServiceToken } from './Service';
import { EventCenter, createEvent } from './Event';
import { RingDeque } from './DataStructure';

const ActorReady = createEvent<{ id: number }>('ActorReady');
const EVENTS = createServiceToken<EventCenter>('Events');
const PENDING = createServiceToken<RingDeque<number>>('LevelPending');

async function exampleLevel(): Promise<void> {
    const root = new ServiceLocator('Game');
    root.registerFactory(EVENTS, () => new EventCenter(), {
        dispose: events => events.dispose(),
    });
    root.registerFactory(PENDING, () => new RingDeque<number>(64), {
        lifetime: 'scoped',
        dispose: queue => queue.clear(),
    });

    // 注册完成后再创建子域 / 解析；Service 注册表随后冻结。
    const level = root.createScope('Level');
    try {
        const events = level.get(EVENTS);
        const pending = level.get(PENDING);
        const listeners = events.createScope();
        try {
            listeners.on(ActorReady, data => pending.pushBack(data.id));
            events.emit(ActorReady, { id: 7 });
            console.log(pending.popFront()); // 7
        } finally {
            listeners.dispose();
        }
    } finally {
        try { await level.disposeAsync(); }
        finally { await root.disposeAsync(); }
    }
}

void exampleLevel().catch(console.error);
```

令牌与事件 token 在共享定义文件创建一次，生产者和消费者导入同一个对象；名称相同不会使两个 token 互通。上例的事件中心属于根域，监听属于关卡；关卡退出先释放监听，根域退出再释放中心。实际业务通过构造参数或 initialize 接收实例，避免到处查询全局容器。

### 生命周期与更新职责

- **Config**：先声明参数，再通过 `definition.setup(...).start()` 启动；从 definition.values 读取。场景退出调用 runtime.dispose，测试工具按需用插件接入。
- **Service**：明确值是借用还是接管，工厂显式声明 initialize / dispose。异步服务先 getAsync；退出必须观察 disposeAsync 的完成或失败，Cocos 不会等待异步 onDestroy。
- **Event**：监听保留句柄或纳入 scope；组件适配器在 onEnable / onDisable / onDestroy 显式调用 enable / disable / dispose。emit 同步分发，不等待 async 回调。
- **Audio**：在音频根节点创建 CocosAudioRuntime，从 `runtime.core` 创建作用域并传入已就绪的 Clip。宿主交互解锁、资源租约和退出清理见音频文档。
- **DataStructure / DirectorSystem**：容器不更新游戏，ClipRunner 需宿主每帧传入 deltaTime；任务上限、暂停、空间索引更新及 Node 回收由业务负责。
- **组件与池**：核对序列化引用及 onEnable / onDisable / onDestroy 链路；停止已有 Tween、归还临时对象和解绑监听的责任以具体组件为准。

## 5. 版本迁移与维护

Config、Event、Service、Audio 和 DataStructure 已采用新的显式 API。旧事件重载 / 监听装饰器、旧服务注册链 / 自动生命周期探测、旧音频静态调用和旧数据结构路径不保证兼容。升级时逐项阅读模块迁移说明，搜索业务 import 与调用点，再处理编译诊断和实际行为。

框架修改遵循以下分工：通用模块只描述机制；玩法规则、配置声明、资源路径、订单 / 战斗等业务留在宿主。新增能力先确认原生集合、现有模块或引擎 API 是否足够，再决定是否增加抽象。

Project2 中的提交顺序是：在框架子仓库完成检查和提交，再在宿主提交子模块指针及配套说明。复制资源时由 Creator 为新资产生成独立身份，不复制已有 `.meta` UUID；修改已有文件时保留它的身份。

## 6. 验证与进一步阅读

框架仓库内没有统一测试启动器。当前宿主 Project2 在 `tools/coco-frame-qx/` 提供专项测试，以下命令均在 **Project2 根目录**运行：

```powershell
node tools/coco-frame-qx/config.test.cjs
node tools/coco-frame-qx/event.test.cjs
node tools/coco-frame-qx/service.test.cjs
node tools/coco-frame-qx/audio.test.cjs
node tools/coco-frame-qx/audio-cocos.test.cjs
node tools/coco-frame-qx/data-structure.test.cjs
```

该宿主另有 `config-panel.test.cjs` 和 `foundation.test.cjs` 验证调试面板及基础模块组合契约。它们不是独立框架仓库附带的工具；复制到其他项目后，应使用目标项目的编译器、声明文件和测试入口。

根据改动选择相关检查：纯逻辑检查类型和行为；组件检查依赖与序列化绑定；涉及音频输出、输入、物理、渲染和平台 SDK 时，在授权的真实运行环境验证。静态检查及引擎替身测试不等同于真实 Preview 或设备表现。

主要阅读入口：[配置](Config/README.md) · [服务](Service/README.md) · [事件](Event/README.md) · [音频](Audio/AudioCore.md) · [数据结构](DataStructure/README.md)。仓库许可证见 [LICENSE](LICENSE)。
