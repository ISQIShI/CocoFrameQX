# 通用音频模块

`AudioCore<Clip>` 接收已取得的音频资源，负责播放调度、作用域、总线和句柄。Cocos 项目使用 `CocosAudioRuntime` 装配 `AudioCore<AudioClip>`。运行时监听根节点寿命、帧更新、前后台和首次输入。播放驱动使用 `AudioSource` 管理声部，并为每个播放句柄独立持有 Clip。纯 TypeScript 核心可用于其他引擎，宿主实现 `AudioDriver<Clip>` 并驱动 `update()`。

## 已有 AudioClip

在 Inspector 绑定 `@property(AudioClip)` 字段，或使用应用已持有的 Clip。组合入口创建运行时，使用方各自创建作用域。

```ts
const runtime = new CocosAudioRuntime(audioRoot, { maxVoices: 24 });
const sceneAudio = runtime.core.createScope('scene');
const music = sceneAudio.play(themeClip, { bus: 'music', loop: true, label: 'theme' });
music.pause();
music.resume();
music.stop();
```

同一 Clip 可以同时用于多个独立句柄。应用若只需一首背景音乐，可以保留句柄，在换曲时先停止旧句柄。

## 动态加载

`BundleAudioClipProvider` 接收一个已经加载的 Cocos Bundle。路径相对于该 Bundle，使用资源路径且省略扩展名。若使用 `resources`，把 Cocos 提供的 `resources` 对象传给构造函数。

```ts
const provider = new BundleAudioClipProvider(resources);
const lease = await provider.acquire('audio/click', sceneSignal);
try {
    if (!sceneSignal.aborted) sceneAudio.play(lease.clip, { bus: 'ui', maxDelay: 0 });
} finally {
    lease.release();
}
```

调用方处理获取失败。失败可按 `AudioClipAcquireError.code` 区分加载、无效资源、无效路径、取消、逐出与关闭。并行同路径请求合并，每个调用方取得独立租约。取消仅撤销本请求。底层 Bundle 无取消接口，无人等待或条目失效后，迟到结果不会写入缓存。

`tryAcquire(path)` 只查询已就绪缓存，命中也返回独立租约。预加载时可以 `acquire` 后立即归还租约。提供者仍保留自己的缓存引用，直至 `evict(path)` 或 `close()`。两者会立即拒绝相应的待加载请求。已交付的租约仍有效。应用先取消等待，释放作用域或运行时，再关闭自己拥有的提供者。共享提供者由它的拥有者关闭。

核心在 `play(clip)` 返回前取得自己需要的引用。调用方可立即释放提供者租约。播放终态先清理声部，再归还核心的引用。Cocos 使用配对的 `addRef/decRef`。

## 播放和生命周期

| 接口 | 职责 |
| --- | --- |
| `AudioCore` | 创建作用域、总线音量及静音、主音量与平台音量、暂停原因、解锁、预算和诊断 |
| `AudioScope` | `play(clip)`、本作用域音量与静音、暂停、停止所有声部及释放 |
| `AudioPlayback` | 独立 ID、状态、完成通知，以及单次播放的暂停、恢复、停止和音量 |
| `CocosAudioRuntime` | 公开 `core`，驱动引擎事件，根节点销毁时解绑并释放核心 |

默认总线为 music、sfx、ui。有效音量是主音量、平台音量、总线音量、作用域音量与句柄音量的乘积。总线或作用域静音时增益为零，播放位置继续推进。平台、后台、游戏与作用域可以分别暂停。所有暂停条件解除后才能恢复。

默认预算为 24 个活跃请求，等待解锁或暂停恢复的请求也占预算。总线达到上限时从该总线选择淘汰对象。否则总预算达到上限时从全局选择。优先级最低且最早接纳的请求先淘汰。新请求的优先级更低时返回 `rejected`。

`play` 同步返回句柄。`pending` 表示等待开始，`playing` 表示已向驱动提交播放，`paused` 表示已提交暂停。`finished` 完成一次，结果为 `ended`、`stopped`、`expired`、`stolen`、`rejected`、`failed` 或 `disposed`。可通过诊断查看作用域、总线、状态、优先级与可选标签。

`maxDelay` 是从 `play(clip)` 到首次提交播放之间的单调秒数，省略时无限等待。`0` 要求立即提交。需要将动态加载算入时限时，由应用在获取资源后计算剩余秒数并传给核心。Cocos 默认等待首次触摸结束、鼠标抬起或键盘抬起解锁。宿主也可在真实交互处理函数内调用 `runtime.unlock()`。

Cocos 各声部使用独立 `AudioSource`。自然结束用 `ENDED` 确认，停止后清空 Clip。实际设备出声和部分异步播放器错误由 Cocos 与目标平台处理，核心的 `playing` 状态只反映命令已提交。

宿主可用 `runtime.addCleanup(unsubscribe)` 登记外部桥接的解绑。GameManager 可通过 `audio` 提供同一核心给多个使用方。
