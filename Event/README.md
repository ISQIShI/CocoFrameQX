# CocoFrameQX - EventCenter 事件中心

`EventCenter` 是专为 TypeScript 环境打造的**高性能、强类型、抗重入、支持枚举隔离的事件分发系统**。

本项目对标并继承了 C# 版 `UniFrameQX.EventCenter` 的核心设计思想，同时结合前端与游戏开发的实际场景进行了深度重构与解耦：
- **本体纯粹化**：去除内置全局静态单例与静态门面，转为纯实例驱动设计，全局访问职责与业务容器解耦；
- **引擎零耦合**：核心模块零依赖任何第三方或游戏引擎库，通过抽象的 `targetValidator` 钩子提供对外扩展支持；
- **纯同步确定性**：去除异步复杂度，专注于低 GC、高吞吐的确定性同步事件分发；
- **Cocos 专属扩展库**：通过外挂式扩展模块（`CocosExtension`）提供 `isValid` 引擎生命周期防御以及组件声明式装饰器（`@listenEvent`）。

---

## 一、 整体架构与设计原则

### 1.1 架构分层

```text
assets/scripts/CocoFrameQX/Event/
├── EventTypes.ts        # 核心契约：事件标识、配置项、元数据与 IEventCenter 接口
├── EventCenter.ts       # 核心实现：纯 TS 事件中心、分发引擎、枚举隔离、防重入、优先级
├── EventScope.ts        # 作用域代理：绑定 defaultTarget、支持局部生命周期一键注销
├── CocosExtension.ts    # Cocos 专属扩展：isValid 引擎防御适配器、解耦的 @listenEvent 装饰器
├── index.ts             # 统一出口入口
└── README.md            # 设计架构与使用指南
```

### 1.2 为什么去除内置全局单例与门面？
原有的全局单例设计会导致：
1. **职责过载**：事件中心既负责“事件的分发与管理”，又负责“全局生命周期的单例维护”；
2. **缺乏多实例灵活性**：在需要局部事件总线（如战斗副本总线、UI 模块内总线、网络通信总线）时受到全局静态限制；
3. **架构污染**：项目已具备专门的单例基础设施（如 `SingletonBase`）与服务容器（`ServiceLocator`），由外部容器或单例包装器统一管理单例，可使事件中心本体更加聚焦、纯粹、易测试。

---

## 二、 核心机制详解

### 2.1 枚举隔离机制（彻底杜绝跨枚举数值碰撞）
在 TypeScript 中，原生数字枚举会编译为底层数字值：
```ts
enum GameEvent { PlayerSpawn = 0, PlayerDied = 1 }
enum UIEvent { ButtonClicked = 0, DialogClosed = 1 }
```
若仅以数值 `0` 作为 Map 的 Key，`GameEvent.PlayerSpawn` 与 `UIEvent.ButtonClicked` 会互相覆盖或误触。

**解决方案：**
`EventCenter` 支持显式传入枚举对象作为 `scope`：
```ts
const bus = new EventCenter();

// 内部自动基于 WeakMap 生成作用域 UID 并拼接复合索引：ScopeUID::0
bus.addListener(GameEvent, GameEvent.PlayerSpawn, this.onSpawn, this);
bus.addListener(UIEvent, UIEvent.ButtonClicked, this.onClick, this);

bus.emit(GameEvent, GameEvent.PlayerSpawn, playerData); // 仅触发 GameEvent 监听器
```

---

### 2.2 目标有效性校验钩子（与 Cocos isValid 解耦适配）
在事件触发执行 `callback.call(this)` 前，若目标对象已被引擎销毁，往往会导致访问空指针或崩溃。
`EventCenter` 本身不依赖任何引擎库，而是提供了一个简洁的 `targetValidator` 抽象钩子：

```ts
export type EventTargetValidator = (target: any) => boolean;
```

当通过 `CocosExtension` 开启 Cocos 扩展后，会自动注入 `(target) => isValid(target)`。分发前若发现目标失效，将**自动跳过调用并清理死引用**。

---

### 2.3 遍历中并发修改安全（Re-entrancy & Snapshot Safety）
如果在事件的回调函数中：
1. 动态移除了自身或其他监听器；
2. 动态注册了新的监听器；
3. 嵌套触发了另一个事件甚至当前事件（递归/重入）。

`EventCenter` 采用**快照遍历 + 软标记删除（Soft-Delete）+ 嵌套深度追踪（`_dispatchDepth`）**机制：
- 分发开始时浅拷贝当前监听列表快照；
- 遍历过程中被移除的项仅标记 `isRemoved = true`；
- 分发嵌套深度归零后触发惰性紧缩（Pruning），将死节点一次性物理剔除。

---

### 2.4 优先级执行（Priority）与中断传播
- **优先级**：支持传入 `priority: number`（数值越大越先执行，默认 0）。插入时已按降序排好，触发时无需排序，保持 $O(1)$ 分发性能；
- **中断传播**：若某个高优先级监听器显式返回 `false`，事件系统将立即停止向后续监听器传播。

---

## 三、 API 完整参考

### 3.1 监听器管理

| 方法名 | 说明 |
| :--- | :--- |
| `addListener(eventID, callback, target?, options?)` | 添加事件监听，支持 target 绑定、优先级、单次监听与 scope 配置 |
| `addListener(scope, eventID, callback, target?, options?)` | **枚举隔离版**：显式指定所属枚举对象或作用域 |
| `addListenerOnce(eventID, callback, target?, priority?)` | 注册单次监听器，触发后自动注销 |
| `addListenerOnce(scope, eventID, callback, target?, priority?)` | 注册带枚举隔离的单次监听器 |
| `removeListener(eventID, callback, target?)` | 移除指定回调的监听（支持限定 target） |
| `removeListener(scope, eventID, callback, target?)` | 移除带枚举隔离的指定监听 |
| `removeByTarget(target)` / `targetOff(target)` | 一键移除指定目标（通常传入 `this`）关联的所有事件监听 |
| `removeByScope(scope)` | 移除指定枚举/作用域下的全部事件监听 |

---

### 3.2 事件触发（同步）

| 方法名 | 异常处理模式 | 返回值 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `triggerEvent(eventID, data?, ...args)` | **严格模式**（对标 C#）：若无监听者直接抛出 Error | `void` | 严密业务逻辑，要求必须有响应者 |
| `tryTriggerEvent(eventID, data?, ...args)` | **宽容模式**（对标 C#）：若无监听者返回 `false` | `boolean` | 不确定是否有监听者，避免 try-catch |
| `emit(eventID, data?, ...args)` | **宽松模式**：不抛异常 | `number`（执行监听数） | 日常业务开发最常用的派发方式 |

---

### 3.3 批量清理与诊断

| 方法名 | 说明 |
| :--- | :--- |
| `containsEvent(eventID, scope?)` | 检查指定事件是否至少包含一个活跃监听者（对标 C# ContainsEvent） |
| `removeEvent(matcher: (info: IEventInfo) => boolean)` | **条件匹配移除**（对标 C#）：遍历元数据，将返回 true 的监听项批量注销 |
| `clearAllEvents()` | 清空事件中心所有已注册的监听（对标 C# ClearAllEvents） |
| `getListenerCount(eventID?, scope?)` | 获取指定事件或全局所有事件的监听总数 |
| `setTargetValidator(validator)` | 配置或更新上下文目标有效性校验钩子 |
| `dump()` | 生成清晰的层级诊断字符串，展示所有注册事件、作用域、目标类名、优先级与调用次数 |
| `printDiagnostics()` | 在控制台打印诊断树 |
| `createScope(name?, defaultTarget?)` | 创建一个子作用域事件总线 `EventScope` |

---

## 四、 全场景实战使用示例

### 示例 1：基础使用（纯实例模式）

```typescript
import { EventCenter } from '../CocoFrameQX/Event';

// 定义事件枚举
export enum GameEvent {
    PlayerSpawn = 'GameEvent.PlayerSpawn',
    PlayerDied = 'GameEvent.PlayerDied'
}

export interface PlayerData {
    id: number;
    hp: number;
}

// 实例化事件中心
const eventCenter = new EventCenter('BattleEventCenter');

class PlayerPresenter {
    public init(): void {
        // 绑定 this 上下文
        eventCenter.addListener(GameEvent.PlayerSpawn, this.onPlayerSpawn, this);
        eventCenter.addListener(GameEvent.PlayerDied, this.onPlayerDied, this);
    }

    public destroy(): void {
        // 组件/控制器销毁时一键注销
        eventCenter.removeByTarget(this);
    }

    private onPlayerSpawn(data: PlayerData): void {
        console.log(`玩家 ${data.id} 出生，HP: ${data.hp}`);
    }

    private onPlayerDied(data: PlayerData): void {
        console.log(`玩家 ${data.id} 阵亡`);
    }
}
```

触发事件：
```typescript
// 严格触发：若无监听者抛出 Error
eventCenter.triggerEvent(GameEvent.PlayerSpawn, { id: 1, hp: 100 });

// 宽容触发：无监听者返回 false
const ok = eventCenter.tryTriggerEvent(GameEvent.PlayerDied, { id: 1, hp: 0 });

// 常用 emit：返回实际调用的监听器数量
const count = eventCenter.emit(GameEvent.PlayerSpawn, { id: 2, hp: 100 });
```

---

### 示例 2：如何与项目的全局单例（如 SingletonBase 或 ServiceLocator）配合？

当游戏需要全局事件总线时，可通过项目的单例基础设施或 `ServiceLocator` 统一托管：

#### 方案 A：使用单例类包装
```typescript
import { SingletonBase } from '../CocoFrameQX/Singleton/SingletonBase';
import { EventCenter } from '../CocoFrameQX/Event';

export class GlobalEventCenter extends SingletonBase {
    public static override autoCreate = true;

    public readonly bus = new EventCenter('GlobalBus');
}

// 业务调用：
GlobalEventCenter.getInstance().bus.emit('SOME_EVENT', data);
```

#### 方案 B：使用 ServiceLocator 注册
```typescript
import { ServiceLocator } from '../CocoFrameQX/Service';
import { EventCenter, createCocosEventCenter } from '../CocoFrameQX/Event';

// 游戏初始化阶段注册
ServiceLocator.registerInstance(EventCenter, createCocosEventCenter('GlobalGameBus'));

// 业务调用
ServiceLocator.get(EventCenter).emit('SOME_EVENT', data);
```

---

### 示例 3：Cocos 扩展支持（`isValid` 防御与 `@listenEvent` 装饰器）

通过 `CocosExtension` 可以获得与 Cocos 引擎深度集成的能力：

#### 1. 全局配置装饰器使用的事件总线
```typescript
import { createCocosEventCenter, setDefaultEventCenter } from '../CocoFrameQX/Event';

// 游戏启动时配置默认事件中心（自带 isValid 校验防御）
const globalBus = createCocosEventCenter('GlobalBus');
setDefaultEventCenter(globalBus);
```

#### 2. 在 Cocos Component 中使用声明式装饰器
```typescript
import { _decorator, Component } from 'cc';
import { listenEvent, listenEventOnce } from '../CocoFrameQX/Event';

const { ccclass } = _decorator;

@ccclass('MonsterController')
export class MonsterController extends Component {
    // 默认 lifecycle 为 'enable'：自动在 onEnable 时监听，在 onDisable 时注销
    @listenEvent('ON_BOSS_ENRAGE')
    private onBossEnrage(rageLevel: number): void {
        console.log('Boss 狂暴，等级:', rageLevel);
    }

    // 支持优先级与作用域
    @listenEvent('GAME_OVER', { priority: 100 })
    private onGameOver(): void {
        console.log('游戏结束，优先处理结算');
    }

    // 单次监听装饰器：触发一次后自动移除
    @listenEventOnce('FIRST_KILL_ACHIEVED')
    private onFirstKill(): void {
        console.log('首杀达成成就播报！');
    }

    // 也支持单独指定特定的局部事件中心
    // @listenEvent('LOCAL_EVENT', { center: myLocalCenter })
}
```

---

### 示例 4：作用域事件总线 `EventScope`（局部生命周期一键托管）

适用于特定 UI 窗口、战斗房间或关卡模块：

```typescript
import { EventCenter, EventScope } from '../CocoFrameQX/Event';

class BattleStage {
    private _scope: EventScope;

    public init(globalCenter: EventCenter): void {
        // 创建绑定到当前实例的作用域
        this._scope = globalCenter.createScope('BattleStageScope', this);

        // 通过 scope 注册的监听，默认自动绑定 target 为 this
        this._scope.addListener('ON_HERO_ATTACK', this.onHeroAttack);
        this._scope.addListener('ON_MONSTER_HIT', this.onMonsterHit);
    }

    public dispose(): void {
        // 战斗结束退出时，一行代码清理该模块在父级总线上的全部事件
        this._scope.dispose();
    }

    private onHeroAttack(damage: number): void {
        // ...
    }

    private onMonsterHit(hp: number): void {
        // ...
    }
}
```

---

### 示例 5：条件批量移除 `removeEvent(matcher)`

完全复现 C# `RemoveEvent(matcher)` 功能，基于元数据自由过滤：

```typescript
// 1. 移除所有 UIEvent 相关的事件
bus.removeEvent(info => info.scope === UIEvent);

// 2. 移除所有由特定对象实例注册的事件
bus.removeEvent(info => info.target === myPresenter);

// 3. 移除指定事件ID的事件
bus.removeEvent(info => info.eventID === 'OBSOLETE_EVENT');

// 4. 移除从未被触发过的监听项
bus.removeEvent(info => info.callCount === 0);
```

---

### 示例 6：诊断输出 `dump()`

```typescript
console.log(bus.dump());
```

输出效果：
```text
📡 EventCenter [BattleEventCenter] (Total Registered: 2)
  🔔 [__default__::GameEvent.PlayerSpawn] (Active Listeners: 1)
    - #1 Target: [PlayerPresenter], Flags: [Calls:1]
  🔔 [obj:UIEvent_1::0] (Active Listeners: 1)
    - #2 Target: [SettingDialog], Flags: [P:10, Calls:0]
```

---

## 五、 总结与设计对比

| 对比项 | 调整前 | 调整后（当前版本） |
| :--- | :--- | :--- |
| **单例设计** | 混入内置静态单例与大量静态门面 API | **完全剥离**，纯实例驱动，交由外部容器或单例类托管 |
| **Cocos 耦合度** | 本体直接 `import { isValid } from 'cc'` | **零耦合**，本体为纯 TS；Cocos 专属特性通过 `CocosExtension` 扩展提供 |
| **执行模式** | 包含 async/await 与 Promise 异步分发 | **纯同步确定性**，无异步开销与异常链问题，更适合游戏即时性分发 |
| **组件开发体验** | 装饰器与本体硬编码绑定 | 装饰器支持 `setDefaultEventCenter` 与动态提供者，解耦且灵活 |
