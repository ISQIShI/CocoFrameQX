# Service：显式工厂与作用域生命周期

本次为破坏性重构。保留 `ServiceLocator` 名称与脚本 `.meta` 身份；`BindingBuilder.ts` 仅因资产身份保留文件名，其内容已改为容器内部记录类型，不再导出旧 builder。旧注册链、自动 `init/dispose` 识别及隐式重建已删除。核心入口 `Service/index.ts` 不加载 `cc`。

## 设计依据

- [VContainer Lifetime Overview](https://vcontainer.hadashikick.jp/scoping/lifetime-overview)：按单例、作用域、瞬态区分实例复用，子作用域向父查找注册。这里采用显式工厂，不引入反射和自动注入。
- [UE Subsystems](https://dev.epicgames.com/documentation/unreal-engine/programming-subsystems-in-unreal-engine)：生命周期与宿主一致的服务管理理念。这里的宿主由应用自行建立根、场景或关卡作用域，不复制 UE 对象系统。
- [Cocos Creator 3.8 节点创建与销毁](https://docs.cocos.com/creator/3.8/manual/en/scripting/create-destroy.html)：适配层使用公开节点 API；销毁会延迟到帧末，失效检测使用 `isValid(value, true)` 拒绝本帧已请求销毁的组件。

## 快速使用

```ts
import { ServiceLocator, createServiceToken } from './Service';

interface Clock { now(): number }
const CLOCK = createServiceToken<Clock>('Clock');
const LEVEL = createServiceToken<{ startedAt: number }>('Level');
const root = new ServiceLocator('Game');
root.registerValue(CLOCK, { now: () => Date.now() });
root.registerFactory(LEVEL, r => ({ startedAt: r.get(CLOCK).now() }), { lifetime: 'scoped' });
const level = root.createScope('Level 1');
const state = level.get(LEVEL);
await level.disposeAsync();
await root.disposeAsync();
```

同名令牌仍互相隔离。令牌泛型不变，不能把 `ServiceToken<string>` 宽化后注册数字。所有注册都必须明确提供工厂或实例，不猜测 class/function。

## 注册和生命周期契约

| API / 生命周期 | 契约 |
| --- | --- |
| `registerFactory(token, factory, options)` | 同步工厂与同步 initialize；完成前不交付实例 |
| `registerAsyncFactory(token, factory, options)` | 异步工厂/initialize，必须 `getAsync` 预热 |
| `registerValue(token, value, options)` | 默认借用；提供 dispose 表示接管，未解析也在退出时释放 |
| singleton（默认） | 缓存和依赖解析都属于注册所在域，不读取子域覆盖 |
| scoped | 每个请求作用域独立缓存，依赖也在请求域解析 |
| transient | 每次新建；记录归请求域，包括释放回调，直到该域结束 |

首次解析（包括失败解析）或创建子作用域后，当前注册表冻结。禁止同域覆盖；子域可在自己的配置阶段覆盖父项。修改全局依赖时重建根域，不提供热替换缓存接口。

`options.initialize`、`options.dispose`、`options.isValid` 都显式声明，不自动调用对象上同名方法。工厂接收到的 resolver 只允许在构造/初始化期间使用；服务运行期间需要其他依赖，应在工厂完成前取出并传入服务。

`get` 不启动未准备的异步服务；已通过 `getAsync` 准备好的缓存实例可用 `get` 取得。并发 `getAsync` 对同一个 singleton/scoped 共享一次初始化，transient 各自初始化。类型系统允许 async 函数赋给 `() => void`，因此同步 initialize 的 Promise 误用另有运行时检查：调用失败、等待其结束并清理，不交付半初始化对象。

初始化失败的缓存记录保留失败结果，不自动重试；需要重试时创建新域。工厂尚未返回的资源由工厂自己负责 `try/finally`；实例已经返回、initialize 失败时由容器调用已登记的 dispose。无效实例报错，不静默重建。

## 关闭与错误

`disposeAsync()` 立即封闭父子树的新解析，等待在途工厂/初始化，然后先完成子域释放，再按依赖图逆拓扑释放自身依赖（无依赖约束时按完成次序逆序）。多次调用返回同一 Promise。退出期间的 `getAsync` 不会交付已关闭域中的实例。

同步、跨 await、并发独立根解析和瞬态循环均通过依赖图检查。释放异常不会阻断后续释放，而是以 `ServiceDisposalError.errors` 聚合抛出。调用方必须观察退出 Promise。释放回调不应等待同一域或其祖先的释放 Promise，这会形成应用自身的等待环。

可释放对象只能由一个记录接管，包括不同根域；相同对象的其他引用应注册为借用。容器不强制取消第三方 Promise：永不完成的工厂会让退出继续等待，工厂应自行实现超时或取消。

`inspect()` 返回只读诊断摘要，包含注册数、实例状态、生命周期，不暴露实例或可变内部集合。

## Cocos 接入

```ts
import { registerComponentInstance, registerComponentFactory } from './Service/CocosServiceExtensions';
registerComponentInstance(root, UI, existingComponent); // 借用，不销毁编辑器节点
registerComponentFactory(root, AUDIO, AudioService, {
    parent: scene, nodeName: 'AudioService', persist: true,
}); // 每次创建独占新节点，释放只销毁自己的节点
```

创建适配器不会复用同名节点。常驻节点必须直接挂当前场景，父节点缺失/已失效明确报错。组件创建失败时立即清理自己新建的节点。不劫持 Component 原型或生命周期；应用在明确的场景退出流程中 `await scope.disposeAsync()`，不要假设 Cocos 会等待异步 `onDestroy`。

## 从旧版本迁移

| 旧接口 | 新接口 |
| --- | --- |
| 字符串、Symbol、Class token | 模块级 `createServiceToken<T>()` 常量 |
| `registerSingleton(Token, Class)` | `registerFactory(Token, r => new Class(...))` |
| `registerScoped` / `registerTransient` | `registerFactory` 的 lifetime 选项 |
| `bind().to().asSingleton()` | 一次明确 `registerFactory` |
| `registerInstance` | `registerValue`，是否传 dispose 决定所有权 |
| `onServiceInit` / `init` | 注册 options.initialize |
| `onServiceDispose` / `dispose` 自动调用 | 注册 options.dispose |
| `unregister` / `clearInstances` / 覆盖注册 | 关闭并重建作用域 |
| `dispose()` | `await disposeAsync()` |
| `registerComponent` | 分为借用 instance 与 owned factory 两个入口 |

本项目代码扫描未发现 Service 业务调用方。模块外使用者按上述表迁移，不提供含糊兼容层。

## 验证

主项目执行 `node tools/coco-frame-qx/service.test.cjs`。测试包含严格类型反例、独立身份、作用域覆盖、异步合流/循环、失败清理、退出竞态和 Cocos 所有权替身。测试不会修改资源，不启动真实 Preview；引擎真实生命周期仍需接入场景后验证。
