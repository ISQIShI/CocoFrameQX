import { AudioClip, AudioSource, isValid, Node } from 'cc';
import type { AudioDriver, AudioVoice } from './AudioCore';

/** 一个句柄独占一个声部。Cocos 的异步 player 就绪和设备解锁仍由引擎负责。 */
export class CocosAudioDriver implements AudioDriver<AudioClip> {
    constructor(private readonly root: Node) {}

    retain(clip: AudioClip): () => void {
        if (!(clip instanceof AudioClip) || !isValid(clip, true)) throw new TypeError('需要有效的 AudioClip');
        clip.addRef();
        return () => { clip.decRef(); };
    }

    createVoice(clip: AudioClip, loop: boolean, onEnded: () => void): AudioVoice {
        if (!isValid(this.root, true)) throw new Error('Audio root has been destroyed');
        const node = new Node('AudioVoice');
        let source: AudioSource;
        try {
            source = node.addComponent(AudioSource);
            source.playOnAwake = false;
            source.loop = loop;
            source.volume = 0;
            source.clip = clip;
            this.root.addChild(node);
        } catch (error) {
            node.destroy();
            throw error;
        }

        let disposed = false;
        let requested = false;
        let volume = 0;
        const ended = (sender: AudioSource): void => {
            if (!disposed && sender === source) onEnded();
        };
        node.on(AudioSource.EventType.ENDED, ended);

        const stopSource = (): void => {
            requested = false;
            try {
                source.volume = 0;
                source.stop();
            } finally {
                // 清空 clip 会使尚未完成的异步 player 安装失效。
                source.clip = null;
            }
        };
        return {
            play: () => {
                if (disposed || requested) return;
                if (!isValid(source, true)) throw new Error('Audio source has been destroyed');
                requested = true;
                source.volume = volume;
                source.play();
            },
            pause: () => {
                if (disposed || !requested) return;
                requested = false;
                source.volume = 0;
                source.pause();
            },
            stop: () => {
                if (!disposed && isValid(source)) stopSource();
            },
            setVolume: value => {
                volume = value;
                if (!disposed) source.volume = requested ? volume : 0;
            },
            dispose: () => {
                if (disposed) return;
                disposed = true;
                try {
                    node.off(AudioSource.EventType.ENDED, ended);
                    if (isValid(source) && source.clip) stopSource();
                } finally {
                    if (isValid(node, true)) node.destroy();
                }
            },
        };
    }
}
