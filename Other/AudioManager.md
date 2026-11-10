# AudioManager

`AudioManager.ts` 是可在多个项目中复用的纯 TypeScript 音频调度器，不导入 `cc`，不读取 `window`、SDK、存储、资源目录或玩法配置。每个实例拥有自己的播放预算、缓存和作用域。Cocos 项目可使用同目录的 `CocosAudioRuntime.ts`；其他引擎实现 `AudioBackend<C>` 即可。

这是破坏性升级：旧静态 API、`firstClick`、全局音乐/音效开关、名称音源表、隐式 `audio/` 前缀和自动保存音量均已移除。

## 设计依据与范围

- [Unity Audio Mixer](https://docs.unity3d.com/6000.0/Documentation/Manual/AudioMixer.html) 的分组混音启发了独立的 music/sfx/ui 总线及层级增益。
- [Godot AudioStreamPlayer](https://docs.godotengine.org/en/stable/classes/class_audiostreamplayer.html) 区分音频资源、播放实例、暂停和自然结束；这里用显式句柄表达每次播放的寿命。
- [Unreal Sound Concurrency](https://dev.epicgames.com/documentation/en-us/unreal-engine/sound-concurrency-reference-guide) 的数量预算和优先级淘汰规则用于控制密集音效。
- [Cocos 3.8 AudioSource](https://docs.cocos.com/creator/3.8/manual/en/audio-system/audiosource.html) 提供可暂停、停止的播放及结束事件。受管理短音使用普通 AudioSource；`playOneShot` 无法按句柄停止，不用于此实现。

以上是架构参考，不表示此模块实现了这些引擎的 DSP 混音、3D 定位、混响、虚拟声部或音乐节拍系统。模块提供调度和生命周期，音频输出仍由后端完成。

## 在 Cocos 中接入

由场景或应用入口创建运行时，向业务注入 `manager`。根节点必须在对应场景内；不要仅凭节点名称寻找或复用别人的全局实例。

```ts
import { CocosAudioRuntime } from './CocosAudioRuntime';

const runtime = new CocosAudioRuntime(audioRoot, {
    maxVoices: 24,
    buses: { music: { maxVoices: 2 }, sfx: { maxVoices: 16 } },
    onError: (error, context) => console.warn(context, error),
});
const level = runtime.manager.createScope('level');
await runtime.manager.preload('sounds/theme'); // 默认适配器的 resources 完整路径
const music = level.play('sounds/theme', { bus: 'music', loop: true, priority: 100 });
level.play('sounds/hit', { bus: 'sfx', maxDelay: 0.2 });
// CocosAudioRuntime 默认等待输入解锁；真实交互处理函数内也可 runtime.unlock()。
music.pause();
music.resume();
level.dispose(); // 仅停止此作用域
runtime.dispose(); // 场景出口：所有监听、音源和本实例的缓存租约
```

默认后端只加载 `resources` bundle，key 不含扩展名，不自动添加目录。加载其他 bundle、远程资源或直接提供片段时，传入自定义后端：`new CocosAudioRuntime(root, options, backend)`；无需更改核心。

`CocosAudioRuntime` 监听 Cocos 前后台、根节点活跃状态、帧更新与销毁，首次触摸结束、鼠标抬起或键盘抬起解除逻辑锁。它不会上报 SDK 交互。浏览器音频设备的自动播放限制仍由引擎处理，逻辑 `unlock()` 不是绕过浏览器政策的接口。

所有外部桥接应加入运行时寿命：`runtime.addCleanup(unsubscribe)`；根节点单独销毁时也会解绑。`dispose()` 可重复调用。普通 Cocos 项目无需引入 `SDK` 或 `GameManager`。

## 核心契约

| 对象 | 主要接口 | 责任 |
| --- | --- | --- |
| AudioManager | `createScope`、`preload`、`unload`、`update`、`dispose`、`snapshot` | 调度、资源合流、预算、实例所有权 |
| AudioScope | `play`、`stopAll`、`setVolume`、`setMuted`、`setPaused`、`dispose` | 场景、窗口或玩法拥有的声音 |
| AudioPlayback | `state`、`finished`、`stop`、`pause`、`resume`、`setVolume` | 单次播放，终态不可恢复 |
| AudioBackend | `load`、`release`、`createVoice` | 资源租约与引擎实现 |
| AudioVoiceBackend | `play`、`pause`、`stop`、`setVolume`、`dispose` | 一次播放独占的音源 |

资源 key 只标识片段。同 key 可同时用于多个句柄、循环/短音和多个作用域，不会互相停止。需要“只保留一个背景音乐”时，由调用方保留旧句柄并先停止，再发起新请求。

有效音量 = 主音量 × 平台音量 × 总线音量 × 作用域音量 × 单次播放音量。任一层为零就得到零；音乐总线不会控制音效总线。有限音量值限制到 0..1，非有限数值拒绝。`setBusMuted` 和作用域 `setMuted` 只静音，不改变播放进度；要丢弃待播声音，显式 `stopAll()`。

`setSuspended(reason, true/false)` 以原因集合合成暂停；平台、后台和游戏暂停互不覆盖。句柄暂停、作用域暂停、全局暂停和逻辑锁均解除后，才允许恢复原有意图。停止、结束、过期或已释放的句柄不会恢复。

默认 24 个活跃请求；music/sfx/ui 总线默认各自不超过总上限，可增加自定义总线。待加载、锁定或暂停中的请求也占预算，避免排队无限增长。达到总线或总预算时，淘汰相应集合中优先级最低且最早接纳的请求；新请求优先级更低则拒绝。优先级数值越大越重要，同优先级淘汰最旧请求。关键循环可指定更高优先级。

`play()` 立即返回句柄。`pending` 表示未向后端提交播放，`playing` 表示已经提交播放命令，`paused` 表示已提交暂停。它们是逻辑状态，不证明扬声器已发声。`finished` 永远以终态字符串完成，不产生拒绝 Promise：

| 终态 | 含义 |
| --- | --- |
| ended | 后端报告自然结束 |
| stopped | 调用方停止 |
| expired | 首次提交播放前超过 maxDelay |
| stolen / rejected | 已接纳的请求被淘汰 / 新请求因预算拒绝 |
| failed | 参数、加载或同步后端操作失败，详情由 onError 报告 |
| disposed | 所属作用域或管理器释放 |

`maxDelay` 以单调秒表度量，包含加载、解锁和暂停等待；首次提交播放后不再计期限。默认无限，0 只接受已经缓存且当前可以提交播放的资源；不能立即播放时直接过期，不启动加载或淘汰其他声音。纯核心由宿主每帧调用 `update()`，Cocos 运行时已自动驱动。`preload` 是资源准备而非播放，会以 Promise 拒绝加载失败；调用方必须处理拒绝。

## 资源与后端所有权

同一实例、同 key 的加载和预热合并为一个 Promise，失败会移除缓存以允许后续重试。成功资源保留在实例缓存直至 `unload(key)` 或 `dispose()`；大型长驻应用应主动卸载离场资源。`unload` 不停止活跃句柄，最后一个持有者结束后释放。释放期间的迟到加载只归还租约，不创建音源或恢复播放。

后端每次成功 `load` 必须交付一个可独立归还的租约，核心最终调用一次 `release`。Cocos 后端使用配对 `addRef/decRef`，不以 `releaseAsset` 强行销毁其他消费者的共享资源。音源先停止和释放，再归还资源。

每个 Cocos 声部独占一个运行时子节点和 AudioSource，`playOnAwake=false`。自然结束在对应节点的 `ENDED` 上确认并核对发送者；主动停止自行完成句柄，不等待 `ENDED`。释放时静音、停止、解绑、`clip=null` 并销毁自有节点，使二次异步 player 加载失效。暂不复用 AudioSource，避免 Cocos 3.8.5 迟到的同片段安装与事件污染新请求；活跃数量由预算限制。

Cocos 3.8.5 会在内部吞掉部分 player 异步加载/播放错误，公共 API 没有对应错误事件。这里不读取私有 player 字段，不把 `playing` 当硬件就绪保证；实际设备发声、浏览器解锁、音频中断仍需目标环境听测。后端不可把正在播放时的重复 `play` 当作幂等操作，核心仅在状态转换时调用。

## 平台和旧入口迁移

| 旧调用/行为 | 新调用/归属 |
| --- | --- |
| `AudioManager.init(source, node)` | 入口 `new CocosAudioRuntime(root)`；不需要预先挂 AudioSource |
| `soundPlay`、`audioPlay`、`musicPlay` | 所属作用域 `play(key, options)` 并保存句柄 |
| `audioStop(name)`、`musicStop()` | 指定句柄 `stop()` 或作用域 `stopAll()` |
| `audioPause(name)`、`resume()` | 句柄 `pause/resume` 或按原因 `setSuspended` |
| `musicVolumeSet`、`audioVolume` | `setBusVolume('music', ...)`、句柄/作用域 `setVolume` |
| `musicEnable/soundEnable` | `setBusMuted('music'/'sfx', ...)`；若需丢弃则停止自己拥有的句柄 |
| `firstClick` | 宿主真实交互调用运行时 `unlock()`，或使用运行时输入监听 |
| SDK 音量、localStorage | SDK 桥接、项目偏好存储，均不在核心中 |

广告项目由入口调用 `PlayableSDK.bindAudio(manager)` 并将返回的解绑函数交给 `addCleanup`。SDK 层处理旧 `window.volumeSwitch`、Ironsource `dapi.getAudioVolume()` 的百分比和 `view` 的 `audioVolumeChange`；桥接事件接受布尔开关或 0..1 数值，非法值忽略。零平台增益添加独立暂停原因，恢复不影响玩家偏好或其他暂停原因。若渠道直接发出自己的事件，渠道适配须转发到约定桥接；核心不监听任何厂商事件。

`GameManager` 只是一个可选组合入口，公开 `audio` 实例供注入。它不再依赖场景预挂 AudioSource，不再默认播放 `audio/bgm`；旧项目需填写新的 `backgroundMusic` 完整资源路径。SDK 首次交互上报从 `start` 移至真实输入，结束和销毁会释放音频与监听。业务已有独立入口时，应由该入口装配服务，不启用第二个 GameManager。

## 验证方式

宿主 Project2 的 `tools/coco-frame-qx/audio.test.cjs` 验证纯核心状态机和严格类型；`audio-cocos.test.cjs` 验证同版本引擎声明及适配器替身；玩法回归验证现有音频意图和组合入口。复制模块到新项目时，至少用该项目的引擎声明重新编译并验证真实输出。仅复制纯核心时不需要安装 Cocos、SDK、Service 或 Event 模块。
