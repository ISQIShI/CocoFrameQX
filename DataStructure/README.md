# 游戏数据结构

[返回框架指南](../README.md)

本模块为游戏运行中的队列、活动集合、优先任务、动态概率、整数标记和邻域检索提供六种容器。全部为纯 TypeScript，不依赖 `cc`、DOM、SDK 或具体玩法。它们负责存储和检索；创建、更新、回收游戏对象，以及每帧处理多少工作，由调用方控制。

## 1. 先选容器

简单存储优先使用原生 `Array`、`Map`、`Set`。后进先出使用数组 `push/pop`；需要保持插入顺序的去重集合使用原生 `Set`；按键保存数据使用 `Map`。仅在需要以下能力时使用本模块。

| 脚本 | 解决的问题 | 主要取舍 |
| --- | --- | --- |
| [RingDeque.ts](RingDeque.ts) | 双端任务队列、帧事件缓冲、FIFO 缓存 | 两端操作无需搬移整段数据；扩容有一次复制成本 |
| [DenseSet.ts](DenseSet.ts) | 高频增删、可按连续序号访问的活动对象集合 | 删除时末项填洞，顺序和序号不稳定 |
| [StablePriorityQueue.ts](StablePriorityQueue.ts) | 可取消、可改优先级、同优先级稳定的任务排序 | 数值越小越先处理；用独立句柄定位入队项 |
| [WeightedTable.ts](WeightedTable.ts) | 运行时经常调权重的掉落、刷怪抽样 | 槽位固定，权重可变，每次独立有放回抽样 |
| [BitSet.ts](BitSet.ts) | 大量连续整数 ID 的访问标记、解锁状态 | 固定容量，只保存索引是否存在 |
| [SpatialHash2D.ts](SpatialHash2D.ts) | 二维区域或俯视 XZ 世界的附近对象查询 | 需要移动后主动更新 AABB，效果取决于格子尺寸和分布 |
| [index.ts](index.ts) | 模块公共导出 | 导出上述六种类及三个类型，无初始化副作用 |

以下复杂度以元素数 `n`、位容量 `c`、队列已分配容量 `a` 表示；Map/Set 操作为平均复杂度，实际分配与垃圾回收开销取决于运行环境。

| 容器 | 查询 / 读取 | 添加 / 修改 / 移除 | 遍历 / 清理 | 存储 |
| --- | --- | --- | --- | --- |
| RingDeque | 两端读取 O(1) | 两端移除 O(1)，添加摊销 O(1)，扩容 O(n) | 遍历和快照 O(n)，非空 clear O(a) | O(a) |
| DenseSet | has / at 平均 O(1) | add / delete 平均 O(1) | 遍历和快照 O(n)，clear 清理全部引用 | O(n) |
| StablePriorityQueue | peek O(1)，has 平均 O(1) | 入队 / 出队 / 删除 / 改优先级 O(log n) | clear 清理全部引用；无公共迭代器 | O(n) |
| WeightedTable | 槽位读取 O(1)，抽样 O(log n) | 构建 O(n)，改权重 O(log n) | 无 clear 或公共迭代器 | O(n) |
| BitSet | has O(1) | add / delete O(1)，集合运算 O(c/32) | 升序遍历 O(c/32 + 置位数)，非空 clear O(c/32) | 约 4 × ceil(c/32) 字节，另有对象开销 |
| SpatialHash2D | has 平均 O(1)，查询 O(访问格数 + 各桶候选总数) | set O(旧格数 + 新格数)，delete O(旧格数) | clear 清理全部对象与桶 | O(n + 所有对象跨格登记数) |

## 2. 导入与共同约定

业务脚本可从 `../CocoFrameQX/DataStructure` 导入；具体相对路径取决于业务文件位置。也可直接导入单个类文件。以下示例按本 README 所在目录使用 `./index`，复制到业务目录时修改导入路径。

```ts
import { RingDeque } from './index';
import type { Bounds2D, PriorityHandle, WeightedEntry } from './index';

const queue = new RingDeque<string>();
const bounds: Bounds2D = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const entries: WeightedEntry<string>[] = [{ value: '金币', weight: 1 }];
const handles: PriorityHandle[] = [];
console.log(queue.size, bounds, entries, handles);
```

- 泛型值按引用保存，容器不会复制、销毁、重置 `Node` 或其他对象。`clear`、删除、出队释放该容器持有的引用；外部引用仍需自行管理。
- `size` 通常是当前元素数；BitSet 是置位数，WeightedTable 是固定槽位数。
- 空队列读取和出队返回 `undefined`。泛型允许存入 `undefined`，此时应以 `size` 判断空状态。
- 泛型键采用原生 Map/Set 的相等规则：对象按身份区分，`NaN` 与自身相等，正负零视为同一键。
- 容量、优先级、权重、坐标等参数会按各自约束校验；非法数值抛出 `RangeError`，不做截断或静默修正。
- RingDeque、DenseSet、BitSet 实现 `Iterable`。迭代器在第一次 `next()` 时记录版本，之后发生有效修改会使后续 `next()` 抛出 `Error`。重复添加集合已有项、删除不存在项、清空空容器不会改变版本；BitSet 集合运算只有实际改变位时才改变版本。
- 需要遍历时删除元素，先取快照：队列 / 紧凑集合使用 `toArray()`，位集合使用 `Array.from(bits)`。快照只复制存储项，引用对象仍共享。
- 本模块不提供每帧预算、线程同步、确定性时钟、实体代次或资源所有权管理；这些规则由业务层组合实现。

## 3. RingDeque：环形双端队列

### 设计思路

内部用数组、头指针和有效长度保存数据，逻辑顺序可以跨过数组尾部再回到开头。普通出入队只移动指针并访问槽位，不使用 `Array.shift()`。数组满时扩为原来的两倍并整理有效项，直到 JavaScript 数组长度上限。

适合顺序消费的消息、寻路工作队列和节点缓存。`initialCapacity` 是预分配提示，**不是最大长度**；容量不足会增长，没有自动丢弃最旧项的策略。需要限制缓存时，由调用方在入队前判断 `size`。

### API

| API | 行为 |
| --- | --- |
| `new RingDeque<T>(initialCapacity = 16)` | 容量须为 `[1, 2^32-1]` 内安全整数；实际可分配量受运行环境限制 |
| `size` | 有效元素数量 |
| `pushBack(value)` / `pushFront(value)` | 从尾 / 头添加，返回 void |
| `popFront()` / `popBack()` | 从头 / 尾移除，返回 `T \| undefined` |
| `peekFront()` / `peekBack()` | 读取两端，不移除，返回 `T \| undefined` |
| `toArray()` / `for...of` | 按队头到队尾顺序读取 |
| `clear()` | 释放全部元素引用，重置头指针，保留已分配数组 |

```ts
import { RingDeque } from './index';

const pending = new RingDeque<{ actorId: number }>(64);
pending.pushBack({ actorId: 1 });
pending.pushBack({ actorId: 2 });
pending.pushFront({ actorId: 0 });

// 一帧最多处理 32 项；回调若继续入队，也受本帧预算约束。
let budget = 32;
while (pending.size > 0 && budget-- > 0) {
    const event = pending.popFront()!;
    console.log('处理', event.actorId);
}
pending.clear();
```

移除立即清空对应槽位，避免缓存继续持有已消费对象。`clear()` 不缩容：偶发巨大峰值后若需要归还整个数组，应释放旧队列并创建新实例。

## 4. DenseSet：紧凑活动集合

### 设计思路

连续数组保存对象，Map 记录“值 → 数组序号”。删除中间项时，将末项移入空位并更新索引，从而避免线性移动剩余项。适合活动弹幕、参与更新的实体和临时参与者集合，尤其是既要去重又要按数字序号读取的情况。

删除可能改变遍历顺序；`at()` 的序号不能当作长期实体 ID。需要稳定插入顺序时使用原生 Set，需要有序显示时另建排序快照。

### API

| API | 行为 |
| --- | --- |
| `new DenseSet<T>()` / `size` | 创建空集合 / 读取数量 |
| `has(value)` | 是否存在 |
| `add(value)` | 新增返回 true，已存在返回 false |
| `delete(value)` | 删除成功返回 true，不存在返回 false |
| `at(index)` | 读取当前序号；非整数、负数或越界返回 undefined |
| `toArray()` / `for...of` | 当前紧凑数组顺序，快照可独立增删 |
| `clear()` | 移除全部项并释放索引关系 |

```ts
import { DenseSet } from './index';

const active = new DenseSet<{ id: number; expired: boolean }>();
active.add({ id: 1, expired: false });
active.add({ id: 2, expired: true });

for (const actor of active.toArray()) {
    if (actor.expired) active.delete(actor);
}
console.log(active.at(0)?.id, active.size);
```

## 5. StablePriorityQueue：稳定最小优先队列

### 设计思路

二叉最小堆按 `(priority, 首次入队序号)` 排序，句柄 Map 和堆内位置用于直接定位待修改项。越小的数越先出队，允许有限负数；同优先级按首次入队顺序，改优先级不会刷新资历。

适合到期时间排序、寻路开放集合或 AI 待处理任务。队列只排序，不读取时钟、不执行回调。到期时间、暂停语义和每帧任务预算均由调用者决定。

### API 与句柄

| API | 行为 |
| --- | --- |
| `new StablePriorityQueue<T>()` / `size` | 创建队列 / 读取数量 |
| `enqueue(value, priority)` | 优先级须有限，返回独立 `PriorityHandle` |
| `peek()` / `dequeue()` | 读取 / 移除最优先的值，空队列返回 undefined |
| `has(handle)` | 句柄是否仍属于此队列的有效项 |
| `remove(handle)` | 取消指定入队项，成功返回 true |
| `setPriority(handle, priority)` | 修改有效项并修复堆，成功返回 true |
| `clear()` | 移除全部项，使全部已有句柄失效 |

同一值可入队多次，每次返回不同句柄。出队、取消或 clear 后，句柄永久失效；其他队列的句柄也无效。无效句柄使 remove / setPriority 返回 false；有效句柄的非法优先级在修改前抛错。句柄不暴露可修改的位置、优先级或值。

```ts
import { StablePriorityQueue } from './index';

const tasks = new StablePriorityQueue<{ name: string; due: number }>();
const refresh = { name: '刷新怪物', due: 10 };
const handle = tasks.enqueue(refresh, refresh.due);

refresh.due = 8;
tasks.setPriority(handle, refresh.due); // 修改值的 due 本身不会重新排序，必须调用此方法。

const now = 8;
let budget = 16;
while (tasks.size > 0 && budget-- > 0) {
    const next = tasks.peek()!;
    if (next.due > now) break;
    console.log(tasks.dequeue()!.name);
}
console.log(tasks.remove(handle)); // 已出队，false。
```

如果用值中的时间判断到期，必须同步更新值和队列优先级。若仅需要取消则保存句柄即可。内部资历序号达到安全整数上限时拒绝新入队；队列变空或 clear 后重置序号，旧句柄不会复活。

## 6. WeightedTable：动态权重抽样表

### 设计思路

值保存于固定槽位，权重保存于求和线段树。叶子保存单项权重，父节点保存子树总和。更新只重算从叶子到根的一条路径；抽样将随机数映射到总权重区间，再沿子树累加区间下降。

适合槽位相对固定、权重会随关卡进度或状态变化的刷怪 / 掉落表。若表很小且只抽一次，原生数组加一次累加遍历通常已经足够。

### API

| API | 行为 |
| --- | --- |
| `new WeightedTable<T>(entries)` | 输入 `readonly WeightedEntry<T>[]`，每项含 value、weight；允许空表 |
| `size` / `totalWeight` | 固定槽位数 / 当前总权重 |
| `valueAt(index)` / `weightAt(index)` | 读取有效整数槽位，越界抛错 |
| `setWeight(index, weight)` | 设置有限非负权重，0 表示暂停该槽位 |
| `sample(random = Math.random)` | RNG 每次须返回有限 `[0, 1)` 数，返回抽中的值 |

```ts
import { WeightedTable } from './index';

const drops = new WeightedTable([
    { value: '金币', weight: 5 },
    { value: '药水', weight: 1 },
    { value: '稀有宝箱', weight: 0 },
]);

drops.setWeight(2, 2);
console.log(drops.totalWeight); // 8
console.log(drops.sample(() => 0.75)); // 稀有宝箱：区间 [6,8)。
```

- 槽位按输入顺序建立，不能增删或替换值；需要改变条目集合时重建表。构建后修改原始条目的 weight / value 字段不会改表，引用值内部的属性仍共享。
- 每次抽样独立、有放回；抽中不会消耗权重。不包含保底、互斥、分组配额或无放回抽样规则。
- 空表或全零总权重不能抽样，会抛出 RangeError；每次 sample 也会调用并验证 RNG。可用 `totalWeight > 0` 预判是否有候选。
- 构建或修改造成总权重溢出时抛错；失败的 setWeight 保留原表。权重归零不会释放该槽位的值引用。
- 权重使用双精度浮点数。极端大小比例可能使很小的概率无法由 RNG 精度表达；重算子树和可避免删除巨大权重后，小权重因增减抵消而永久丢失。
- 确定性回放由调用者注入有种子的随机源，并保持相同条目顺序、权重更新顺序与抽样次数。

## 7. BitSet：固定容量位集合

### 设计思路

每个索引占一位，32 个索引共用一个 Uint32Array 元素，另存置位总数。适合密集连续编号的格子访问、技能解锁和状态标记；稀疏的大 ID 更适合 Set。

### API

| API | 行为 |
| --- | --- |
| `new BitSet(capacity)` | capacity 须为 `[0, 2^32-1]` 内安全整数；实际可分配量受环境限制 |
| `capacity` / `size` | 可用索引数量 / 当前置位数量 |
| `has(index)` | 查询是否置位 |
| `add(index)` / `delete(index)` | 置位 / 清位，实际改变时返回 true |
| `unionWith(other)` / `intersectWith(other)` | 原地并集 / 交集，要求容量完全一致，other 不变 |
| `clone()` | 返回独立副本 |
| `for...of` | 按升序遍历所有置位索引 |
| `clear()` | 清空全部位，保留容量 |

所有索引 API（包括 has）都要求整数且在 `[0, capacity)`，否则抛出 RangeError。容量 0 合法，但没有任何有效索引。

```ts
import { BitSet } from './index';

const visited = new BitSet(128);
visited.add(31);
visited.add(32);
visited.add(127);

const reachable = new BitSet(128);
reachable.add(32);
const intersection = visited.clone();
intersection.intersectWith(reachable);
console.log(Array.from(intersection)); // [32]，visited 保持不变。

for (const index of Array.from(visited)) visited.delete(index);
```

对象 ID 若会被复用，位集合不能区分新旧实体；实体销毁时要清位，或由业务另建代次校验。它也不把枚举掩码自动拆成多个索引，少量整数标志可直接用原生位运算或 `Utils/FlagUtil`。

## 8. SpatialHash2D：动态二维空间索引

### 设计思路

将世界划分为固定大小网格，每个对象登记到自身 AABB 覆盖的所有格子。查询访问范围覆盖的桶，再以实际 AABB 相交过滤并使用 Set 去重。支持负坐标、点和零面积范围，闭区间边界接触也算相交。

适合附近攻击目标、范围触发和碰撞前的候选筛选。结果符合 AABB 相交，不等同于圆形距离或任意形状碰撞；业务可继续做距离、阵营等过滤。俯视三维场景可将世界 Z 映射到这里的 Y。

### API

| API | 行为 |
| --- | --- |
| `new SpatialHash2D<T>(cellSize, maxCellsPerOperation = 4096)` | cellSize 为有限正数，访问上限为正安全整数 |
| `cellSize` / `maxCellsPerOperation` / `size` | 网格尺寸 / 单次范围格数预算 / 登记对象数量 |
| `has(value)` | 是否已登记 |
| `set(value, bounds)` | 新增或替换该值的登记范围，复制输入包围盒 |
| `getBounds(value)` | 返回包围盒副本，未登记返回 undefined |
| `delete(value)` | 移除登记并清理空桶，成功返回 true |
| `query(bounds, out?)` | 返回 Set；成功时先清空传入的 out，再填充去重结果 |
| `clear()` | 移除所有对象与桶 |

`Bounds2D` 含有限数值 `minX/minY/maxX/maxY`，须满足 min ≤ max。范围映射后的格坐标必须为安全整数；范围覆盖格数超过预算会抛错。set 在校验完新范围后才删除旧登记，非法更新保留原状态；非法 query 保留调用方传入的 out。

```ts
import { SpatialHash2D } from './index';

const index = new SpatialHash2D<string>(2, 4096);
index.set('敌人A', { minX: -1, minY: 0, maxX: 1, maxY: 2 });
index.set('敌人B', { minX: 8, minY: 0, maxX: 9, maxY: 1 });

const candidates = new Set<string>();
index.query({ minX: 0, minY: 0, maxX: 3, maxY: 3 }, candidates);
console.log(Array.from(candidates)); // ['敌人A']。

// 移动后显式更新；仅移动节点不会改变空间索引。
index.set('敌人A', { minX: 4, minY: 0, maxX: 6, maxY: 2 });
index.delete('敌人B');
```

格子过小增加跨格登记，格子过大增加桶内候选；按实体尺度、密度和常见查询范围选取。网格边界为闭区间，例如 `[0,2]` 在尺寸 2 下会覆盖坐标 0 和 1 两格，以保证边界接触可被找到。

4096 是单个新登记范围或查询范围的格数限制，不是结果数量或毫秒预算；更新还会移除旧范围的登记。大量对象集中于同一桶时，查询仍可退化为线性扫描。复用 out 可以复用结果集合，但实现仍会分配格子列表，不能据此宣称查询零分配。不保证返回顺序。

## 9. 项目接入与验证

本目录为全新 API，旧目录路径和旧类型未保留兼容导出。宿主 Project2 已迁移的消费者：

| 消费者 | 选择 |
| --- | --- |
| `Global/ProductManager.ts` | RingDeque，缓存物品按 FIFO 复用 |
| `FloatingText/FloatingTextManager.ts` | RingDeque，缓存飘字节点 |
| `DirectorSystem/ClipRunner.ts` | RingDeque，按加入顺序执行片段 |
| `Product/ProductContainer.ts` | 原生 Node[] 存已到达物品，原生 Set 存在途项 |
| `Actor/Bag.ts` | 跟随 ProductContainer 使用数组索引，不为简单堆叠额外包装容器 |

在宿主 **Project2 根目录**执行：

```powershell
node tools/coco-frame-qx/data-structure.test.cjs
```

该脚本位于宿主仓库，不随独立框架子模块分发。它使用本机 Creator TypeScript 编译器，以 ES2015、strict / noUnused 检查核心和类型负例，并进行 13 组确定性模型及消费者测试：原生数组、Set、独立稳定排序、累加权重、暴力 AABB 查询等作为参考模型。Cocos 消费者使用引擎替身，覆盖 FIFO、片段执行、物品容器和背包语义，不替代真实编辑器、物理、渲染或设备性能验证。

复制到其他项目时，使用目标项目的 TypeScript / 引擎声明重新检查调用代码；根据实际队列峰值、概率尺度和空间分布测量性能。框架整体接入方式见 [框架指南](../README.md)。
