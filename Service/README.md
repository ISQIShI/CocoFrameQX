# CocoFrameQX - ServiceLocator 服务定位器

`ServiceLocator` 是专为 Cocos Creator TypeScript 环境打造的**高性能、强类型、轻量级、完全解耦的服务定位器框架**。  
其核心设计理念是**“去掉了自动/隐式反射依赖注入的纯粹 IoC 容器”**——本体不附带任何全局单例与引擎强依赖代码，专注于**容器实例管理、生命周期管控、层级作用域与循环依赖安全防御**；全局访问与 Cocos 引擎适配均通过标准外部模块与扩展（Extension）实现解耦。

---

## 一、 整体架构与设计原则

### 1.1 核心设计原则
1. **纯粹实例驱动（No Global Singleton Inside）**：
   - 定位器本体为纯粹的类实例（`new ServiceLocator()`），**不包含**任何全局静态单例或全局静态门面 API。
   - 杜绝全局状态滥用与多容器场景下的静态冲突。若业务需要全局访问，可自由结合项目的单例基类（如 `SingletonBase`）或导出全局模块常量实现，职责单一清晰。
2. **零引擎耦合与插件化扩展（Engine-Agnostic Core）**：
   - 定位器本体（`ServiceLocator`、`BindingBuilder`、`ServiceTypes`）为 **100% 纯 TypeScript 实现**，不依赖 Cocos 引擎的任何模块（无 `import 'cc'`）。
   - 通过提供 `InstanceValidator` 扩展插槽，将 Cocos 的 `isValid` 状态校验、节点自动挂载与跨场景常驻解耦至独立的 `CocosServiceExtensions.ts`。
3. **显式工厂，杜绝黑盒反射**：
   - 不依赖实验性装饰器和元数据反射，无任何运行时黑盒注入开销。
   - 通过清晰的高阶工厂函数 `(c) => new BattleService(c.get(IAudio), c.get(IConfig))` 显式解析装配依赖，简单高效，断点直达。
4. **100% TypeScript 编译期类型安全**：
   - 结合类构造函数重载与专为接口设计的 `ServiceToken<T>` 幽灵类型推导，使面向类与面向接口编程均获得毫无折损的 IDE 代码补全。

### 1.2 模块划分

```text
assets/scripts/CocoFrameQX/Service/
├── ServiceTypes.ts             # [核心] 类型系统、ServiceToken、生命周期枚举与契约接口（纯 TS）
├── BindingBuilder.ts           # [核心] 链式 Fluent API 构造器与状态机（纯 TS）
├── ServiceLocator.ts           # [核心] 服务定位器核心容器与层级解析引擎（纯 TS）
├── CocosServiceExtensions.ts   # [扩展] Cocos Creator 引擎适配扩展（生命周期感知、组件挂载、常驻节点）
├── index.ts                    # 统一出口入口文件
└── README.md                   # 架构与使用文档
```

---

## 二、 各部分实现机制与职责详解

### 2.1 `ServiceTypes.ts`（类型系统与生命周期契约 - 纯 TS）
定义了服务定位器运作的基础数据结构，完全独立于任何引擎环境。

- **`ServiceToken<T>` 与 `createServiceToken<T>()`**：  
  利用幻影类型 `readonly __type?: T`，解决 TypeScript 接口在编译成 JavaScript 后被擦除、无法直接作为运行时键的痛点。
- **`ServiceLifetime` 生命周期枚举**：
  - `Singleton`（单例）：在容器或作用域树中唯一，支持惰性加载与立即加载。
  - `Scoped`（作用域单例）：在当前定位器作用域内唯一。各子作用域独立实例化，随子作用域销毁而释放。
  - `Transient`（瞬态）：每次获取均通过工厂重新创建新实例，不保留缓存。
- **`IServiceLifecycle` 统一生命周期接口**：
  - `onServiceInit(locator)` / `init(locator)`：服务首次实例化后自动回调（支持异步 Promise）。
  - `onServiceDispose()` / `dispose()`：服务注销或定位器销毁时自动调用，遵循 LIFO 逆序销毁。
- **`InstanceValidator` 实例校验契约**：
  - 定义了 `(instance: any, token: ServiceIdentifier) => boolean` 签名，允许外部扩展（如 Cocos 引擎）接入对象的有效性判断，无需修改定位器本体。

---

### 2.2 `BindingBuilder.ts`（Fluent 链式语法糖 - 纯 TS）
将注册流程解耦为两段式状态机：

1. **`IBindingTo<T>`（绑定目标）**：
   - `.to(ImplementationClass)`：绑定到实现类。
   - `.toFactory((locator) => ...)`：绑定到工厂函数。
   - `.toInstance(instance)` / `.toValue(instance)`：绑定已有实例。
2. **`IBindingScope<T>`（配置范围与生命周期）**：
   - `.asSingleton()`：标记为单例（默认）。
   - `.asScoped()`：标记为作用域单例。
   - `.asTransient()`：标记为瞬态。
   - `.eager()`：单例声明为立即实例化。
   - `.onDispose((inst) => ...)`：附加专属销毁清理钩子。

---

### 2.3 `ServiceLocator.ts`（核心定位容器 - 纯 TS）
定位器本体负责所有核心算法与容器状态维护，纯 TS 实现，无全局变量：

1. **层级作用域解析（Hierarchical Scope Resolution）**：
   - 优先查找当前容器的 `_instances` 缓存；若设置了 `InstanceValidator`，先校验实例是否有效（失效则自动驱逐）。
   - 若未缓存，查找当前容器注册表 `_bindings`。
   - 若当前容器未注册且存在父容器 `parent`：
     - 若父容器中该服务标记为 `Scoped`，则**在当前请求作用域中实例化并缓存**。
     - 若标记为 `Singleton` 或 `Transient`，则向上委托父容器解析。
2. **全局循环依赖检测（Circular Dependency Detection）**：
   - 由根定位器统一维护 `_resolutionStack`。
   - 解析前入栈，解析完成后在 `finally` 中出栈。
   - 检测到闭环时立即抛出格式化异常（如 `A -> B -> C -> A`），彻底杜绝调用栈溢出。
3. **LIFO 逆序销毁保证（Reverse-Order Disposal）**：
   - 内部由 `_instantiatedRecords` 按实例化先后次序记录。
   - `dispose()` 触发时，按**后创建先销毁（LIFO）**顺序依次调用各服务的销毁钩子，确保上层业务在注销阶段仍能安全访问其依赖项。
4. **异步初始化就绪（Async Ready）**：
   - `getAsync(token)`：异步获取并自动等待该服务的 `onServiceInit` Promise。
   - `initAllAsync()`：并行预热容器内全部单例/作用域服务。
5. **树状诊断（Diagnostics Dump）**：
   - `dump()` / `printDiagnostics()` 输出直观的可视化依赖树。

---

### 2.4 `CocosServiceExtensions.ts`（Cocos Creator 适配扩展）
将与 Cocos 引擎相关的逻辑完全剥离为可选扩展，包含：

1. **`enableCocosValidation(locator)`**：
   - 为定位器安装 Cocos `isValid(instance)` 校验器。
   - 一旦引擎将组件或节点销毁，定位器能敏锐感知并自动清除死引用，防止逻辑使用“僵尸对象”崩溃。
2. **`createComponentFactory(ctor, options)`**：
   - 构造一个标准的 `ServiceFactory<T>`，用于延迟查找或在场景中创建节点挂载组件，并可自动设置跨场景常驻根节点（`director.addPersistRootNode`）。
3. **`registerComponent(locator, token, componentOrCtor, options)`**：
   - 高阶组件注册扩展函数。自动为容器启用 Cocos 校验，并注入安全的注销回调（如自动卸载常驻节点）。

---

## 三、 完整功能使用示例

### 示例 1：创建容器与基础单例解析（面向类）

```typescript
import { ServiceLocator } from './CocoFrameQX/Service';

export class AudioService {
    public playMusic(name: string) {
        console.log(`播放音频: ${name}`);
    }
}

// 1. 创建服务定位器实例（非全局静态单例）
const locator = new ServiceLocator('AppServices');

// 2. 注册单例服务（默认懒加载，首次获取时才实例化）
locator.registerSingleton(AudioService, AudioService);

// 3. 解析获取服务（自动推导类型为 AudioService）
const audio = locator.get(AudioService);
audio.playMusic('bgm.mp3');

// 4. 安全尝试获取（不存在时返回 undefined，不抛出异常）
const nonExist = locator.tryGet('UnknownToken'); // undefined
```

---

### 示例 2：面向接口解耦与 `createServiceToken`（100% 强类型）

```typescript
import { ServiceLocator, createServiceToken, IService } from './CocoFrameQX/Service';

// 1. 定义业务接口
export interface IUserService extends IService {
    getUserInfo(): { id: string; name: string };
}

// 2. 创建类型化令牌
export const IUserService = createServiceToken<IUserService>('IUserService');

// 3. 编写具体实现类
export class UserService implements IUserService {
    public onServiceInit(locator: ServiceLocator) {
        console.log('UserService 初始化');
    }
    public onServiceDispose() {
        console.log('UserService 释放');
    }
    public getUserInfo() {
        return { id: '1001', name: '小明' };
    }
}

const locator = new ServiceLocator();

// 4. 将接口令牌绑定到具体实现类
locator.registerSingleton(IUserService, UserService);

// 5. 消费方仅面向接口编程，享受完全的代码提示
const user = locator.get(IUserService); // 类型自动锁定为 IUserService
console.log(user.getUserInfo().name);
```

---

### 示例 3：显式依赖装配（工厂函数构造依赖）

```typescript
import { ServiceLocator } from './CocoFrameQX/Service';
import { IUserService } from './UserService';

export class BattleService {
    private readonly _user: IUserService;

    public constructor(user: IUserService) {
        this._user = user;
    }

    public startBattle() {
        console.log(`玩家 ${this._user.getUserInfo().name} 进入了战斗`);
    }
}

const locator = new ServiceLocator();
locator.registerSingleton(IUserService, UserService);

// 通过工厂方法显式从当前容器中解析前置依赖
locator.registerSingleton(BattleService, (c) => {
    const user = c.get(IUserService);
    return new BattleService(user);
});

const battle = locator.get(BattleService);
battle.startBattle();
```

---

### 示例 4：三大生命周期对比（Singleton / Scoped / Transient）

```typescript
import { ServiceLocator } from './CocoFrameQX/Service';

class RandomIdService {
    public readonly id = Math.random();
}

const rootLocator = new ServiceLocator('Root');

// 1. Singleton：全局唯一单例
rootLocator.registerSingleton('UniqueId', RandomIdService);
console.log(rootLocator.get('UniqueId').id === rootLocator.get('UniqueId').id); // true

// 2. Transient：瞬态，每次获取创建新实例
rootLocator.registerTransient('NewId', RandomIdService);
console.log(rootLocator.get('NewId').id === rootLocator.get('NewId').id); // false

// 3. Scoped：在各子作用域内各自单例
rootLocator.registerScoped('ScopedId', RandomIdService);

const scopeA = rootLocator.createScope('ScopeA');
const scopeB = rootLocator.createScope('ScopeB');

console.log(scopeA.get('ScopedId').id === scopeA.get('ScopedId').id); // true（同作用域同实例）
console.log(scopeA.get('ScopedId').id === scopeB.get('ScopedId').id); // false（跨作用域独立实例）
```

---

### 示例 5：多级子作用域与 LIFO 逆序销毁（关卡/战斗场景）

```typescript
import { ServiceLocator, IService } from './CocoFrameQX/Service';

class LevelState implements IService {
    public onServiceInit() { console.log('1. LevelState 初始化'); }
    public onServiceDispose() { console.log('4. LevelState 销毁'); }
}

class MonsterSpawner implements IService {
    public onServiceInit() { console.log('2. MonsterSpawner 初始化'); }
    public onServiceDispose() { console.log('3. MonsterSpawner 销毁（上层先销毁）'); }
}

const mainLocator = new ServiceLocator('Main');

// 1. 进入关卡时创建关卡专属子作用域
const levelScope = mainLocator.createScope('Level_101');

// 2. 注册仅在该关卡生命周期中存在的服务
levelScope.registerSingleton(LevelState, LevelState);
levelScope.registerSingleton(MonsterSpawner, MonsterSpawner);

levelScope.get(LevelState);
levelScope.get(MonsterSpawner);

// 3. 关卡退出或场景切换时，一键安全销毁
levelScope.dispose();
// 控制台严格按后创建先销毁（LIFO）顺序输出：
// -> 3. MonsterSpawner 销毁
// -> 4. LevelState 销毁
```

---

### 示例 6：结合项目单例基类实现全局访问（职责分离）
服务定位器本体不包含全局静态代码，若项目需要全局定位器，推荐结合 `SingletonBase` 封装：

```typescript
import { SingletonBase } from '../Singleton/SingletonBase';
import { ServiceLocator } from './ServiceLocator';

/**
 * 全局业务定位器管理器（仅负责持有全局定位器实例）
 */
export class GlobalServices extends SingletonBase {
    public static override autoCreate = true;

    public readonly locator = new ServiceLocator('GlobalServices');

    protected override onSingletonDestroy(): void {
        this.locator.dispose();
    }
}

// 业务中随处使用全局容器：
const globalLocator = GlobalServices.getInstance().locator;
globalLocator.registerSingleton(AudioService, AudioService);
```

或者使用更轻量的导出常量方案：
```typescript
// AppServices.ts
export const appLocator = new ServiceLocator('AppRoot');
```

---

### 示例 7：Cocos Creator 引擎适配扩展（组件服务与跨场景常驻）
借助 `CocosServiceExtensions.ts`，让定位器安全管理 Cocos 组件，同时保持核心代码纯净。

```typescript
import { _decorator, Component } from 'cc';
import { ServiceLocator, registerComponent } from './CocoFrameQX/Service';
const { ccclass } = _decorator;

@ccclass('UIManager')
export class UIManager extends Component {
    public showMessage(text: string) {
        console.log(`[UI] ${text}`);
    }
}

const locator = new ServiceLocator('SceneLocator');

// 注册 Cocos 组件服务：
// 1. 自动开启 Cocos isValid 判定，避免使用已被引擎销毁的组件。
// 2. 自动在场景根节点创建名为 '__UIManager__' 的节点并挂载组件。
// 3. 标记为 persist: true，自动加入 director.addPersistRootNode 跨场景常驻。
registerComponent(locator, UIManager, UIManager, {
    persist: true,
    nodeName: '__UIManager__'
});

const ui = locator.get(UIManager);
ui.showMessage('欢迎使用 CocoFrameQX');
```

---

### 示例 8：异步初始化与 Loading 预热（`getAsync` 与 `initAllAsync`）

```typescript
import { ServiceLocator, IService } from './CocoFrameQX/Service';

class RemoteConfigService implements IService {
    public isReady = false;

    public async onServiceInit() {
        console.log('开始加载网络配置...');
        await new Promise(resolve => setTimeout(resolve, 800)); // 模拟异步加载
        this.isReady = true;
        console.log('网络配置就绪');
    }
}

const locator = new ServiceLocator();
locator.registerSingleton(RemoteConfigService, RemoteConfigService);

// 方式 A：单独等待异步就绪
async function loadSingle() {
    const config = await locator.getAsync(RemoteConfigService);
    console.log(config.isReady); // true
}

// 方式 B：游戏 Loading 场景预热容器内全部单例服务
async function onGameLoadingScreen() {
    console.log('预热并等待所有常驻服务就绪...');
    await locator.initAllAsync();
    console.log('所有核心服务均已初始化完毕，平滑切换主场景！');
}
```

---

### 示例 9：流畅链式语法（Fluent API）

```typescript
import { ServiceLocator, createServiceToken } from './CocoFrameQX/Service';

interface INetwork { send(msg: string): void; }
const INetwork = createServiceToken<INetwork>('INetwork');

class HttpNetwork implements INetwork {
    public send(msg: string) { console.log(`Http 发送: ${msg}`); }
}

const locator = new ServiceLocator();

// 链式单例绑定并立即实例化
locator.bind(INetwork)
    .to(HttpNetwork)
    .asSingleton()
    .eager();

// 链式自定义瞬态工厂与清理回调
locator.bind('TempConfig')
    .toFactory(() => ({ timestamp: Date.now() }))
    .asTransient()
    .onDispose((inst) => {
        console.log('清理临时配置:', inst);
    });
```

---

### 示例 10：循环依赖安全拦截

```typescript
import { ServiceLocator } from './CocoFrameQX/Service';

class ServiceA { constructor(b: any) {} }
class ServiceB { constructor(a: any) {} }

const locator = new ServiceLocator();
locator.registerSingleton(ServiceA, (c) => new ServiceA(c.get(ServiceB)));
locator.registerSingleton(ServiceB, (c) => new ServiceB(c.get(ServiceA)));

try {
    locator.get(ServiceA);
} catch (error) {
    // 捕获清晰的死循环调用链路异常：
    // Error: [ServiceLocator] 检测到循环依赖异常: ServiceA -> ServiceB -> ServiceA
    console.error(error.message);
}
```

---

### 示例 11：容器依赖树诊断（`dump()` 与 `printDiagnostics()`）

```typescript
import { ServiceLocator } from './CocoFrameQX/Service';

const root = new ServiceLocator('RootContainer');
root.registerSingleton('Config', class Config {});
root.registerTransient('FactoryItem', class Item {});

const child = root.createScope('BattleSceneScope');
child.registerSingleton('BattleManager', class BattleManager {});

// 触发实例化
root.get('Config');
child.get('BattleManager');

// 打印诊断信息
root.printDiagnostics();
```

**控制台输出**：
```text
📦 Locator [RootContainer] (ID: 1, Disposed: false)
  - Config -> Lifetime: Singleton  (✅ Active)
  - FactoryItem -> Lifetime: Transient  (⏳ Pending)
  Scopes:
    📦 Locator [BattleSceneScope] (ID: 2, Disposed: false)
      - BattleManager -> Lifetime: Singleton  (✅ Active)
```
- `✅ Active`：已实例化常驻。
- `⏳ Pending`：已注册，等待首次获取时懒加载。
