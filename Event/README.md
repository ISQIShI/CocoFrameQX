# 类型化事件系统

Event 是不依赖 Cocos 的同步事件模块。每种消息以独立 token 标识，每次订阅返回独立释放句柄。中心由项目创建，可以作为 Service 容器的一个服务；没有全局默认中心。

## 基本使用

```ts
import { createEvent, EventCenter } from './Event';

export const Damage = createEvent<{ amount: number }>('战斗/受击');
export const Ready = createEvent('关卡/就绪');
const events = new EventCenter({ name: '关卡' });
const subscription = events.on(Damage, data => { console.log(data.amount); });
events.emit(Damage, { amount: 10 });
events.emit(Ready);
subscription.dispose();
events.dispose();
```

token 名称仅用于诊断，两个 `createEvent('相同名称')` 不互通。应在一个消息定义模块创建并导出 token，发布与订阅导入同一对象。载荷类型保持不变，不允许把 `EventToken<具体类型>` 扩宽为 `EventToken<unknown>` 绕过检查。普通对象载荷按引用传递；需要不可变数据时，由消息生产者冻结或约定只读。

`on` 和 `once` 可传 `{ priority: 10 }`，较大优先级先执行，相同优先级保持注册顺序。重复注册相同回调得到两个独立订阅，分别释放；不隐式去重。回调的返回值不会中断传播。

## 生命周期

```ts
const viewScope = events.createScope();
viewScope.on(Damage, data => { console.log(data.amount); });
viewScope.once(Ready, () => { console.log('只响应一次'); });
viewScope.dispose();
```

EventScope 是订阅所有权袋，不是消息命名空间，也不创建独立总线。两个 scope 可以订阅相同 token，释放一个不会影响另一个。命名空间用不同 token 或独立 EventCenter 表达。

- `subscription.dispose()` 幂等，只解绑本次注册，`closed` 立即变为 true。
- `scope.clear()` 释放所有现有订阅，之后允许再次注册；`scope.dispose()` 永久关闭。
- once 执行、句柄释放、中心清理都会立即解除 scope 的引用，不积累历史记录。
- `center.clear(event)` 释放该 token 的订阅；`center.clear()` 释放所有订阅。清理过程线性遍历关闭句柄。
- `center.dispose()` 永久关闭；再次注册、创建 scope 或 emit 均抛错。重复释放、重复清理安全。
- `center.inspect()` 返回冻结的统计快照，不暴露回调。scope 的 `listenerCount` 是自己的订阅数。

## 分发与异常契约

分发是同步的；无监听时 `emit` 返回零，有监听时返回实际调用次数。默认把所有同步异常收集为 `EventDispatchError.failures`，完成本轮剩余监听后抛出。可提供 `onError(failure)` 接管异常；如果错误处理器本身抛错，原始异常和报告异常均加入最终汇总。

```ts
const events = new EventCenter({
    onError: failure => { console.error(failure.eventName, failure.subscriptionId, failure.error); },
});
```

- 开始分发时读取稳定列表；本轮新增监听不进入当前分发，递归 emit 会读取新列表。
- 尚未执行的监听被释放后，本轮跳过；clear/dispose 在回调中立即生效。
- once 在回调前解绑，递归 emit 和回调抛错都不会重复执行。
- **不 await 回调，不提供异步完成、异步错误汇总或任务取消。** TypeScript 的 void 回调赋值规则仍允许传入 async 函数，但其 Promise 拒绝不属于 emit 的错误处理范围。需要异步工作的监听应显式启动任务并自行 `.catch(...)`；需要等待结果的操作应调用 Service 的业务方法。
- 订阅表在增删时复制，稳定分发不复制监听数组；这是针对游戏中多次分发、相对较少注册的取舍。

## Cocos 显式接入

核心 `Event/index.ts` 不导出引擎适配器，避免普通 TypeScript 环境导入 `cc`。单独导入 `CocosExtension`。

```ts
import { Component } from 'cc';
import { EventCenter } from './Event';
import { CocosEventBinding } from './Event/CocosExtension';
import { Damage } from './GameEvents';

class HealthView extends Component {
    private binding?: CocosEventBinding;

    // 由场景组合根注入中心；显式替换时先释放旧绑定。
    initialize(events: EventCenter): void {
        this.binding?.dispose();
        this.binding = new CocosEventBinding(events, this, binding => {
            binding.on(Damage, data => { this.showDamage(data.amount); });
        });
        if (this.enabledInHierarchy) this.binding.enable();
    }
    protected onEnable(): void { this.binding?.enable(); }
    protected onDisable(): void { this.binding?.disable(); }
    protected onDestroy(): void { this.binding?.dispose(); }
    private showDamage(amount: number): void { console.log(amount); }
}
```

`enable()` 幂等，每次重新启用重建订阅，因此一次性监听每个启用周期可执行一次。连接过程中抛错会回滚本次已建立的订阅。适配器用公开 `isValid(receiver, true)` 拦截包括待销毁状态在内的接收者，拦截时释放整组绑定；正常及时释放仍依赖组件显式调用生命周期方法。没有装饰器、原型修改、隐式 target 绑定或默认服务查找。

## 设计参考与边界

- [MessagePipe](https://github.com/Cysharp/MessagePipe)：借鉴独立订阅句柄与订阅组的显式释放。
- [Godot Signal](https://docs.godotengine.org/en/stable/classes/class_signal.html)：借鉴明确的连接、一次性监听与生命周期边界；本实现不复制其重复连接策略。
- [Cocos Component 生命周期](https://docs.cocos.com/creator/3.8/manual/zh/scripting/life-cycle-callbacks.html)：适配器由业务组件明确调用生命周期，不改写引擎回调。

仅借鉴契约，不引入第三方运行时或复制其实现。延迟事件、消息回放、线程通信和异步消息管线不在本模块范围。
