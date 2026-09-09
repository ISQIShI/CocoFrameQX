import { _decorator, assetManager, AudioClip, AudioSource, sys, game, Game, view, Node } from "cc";

class AudioItem {
    audioSource: AudioSource;
    playing: boolean;
}

export class AudioManager {
    private static _audioSource?: AudioSource;
    private static _cachedAudioClipMap: Record<string, AudioClip> = {};

    private static audioSourceMap: Record<string, AudioItem> = {};
    private static rootNode: Node;

    private static basePath = 'audio/';

    public static musicEnable: boolean = true;
    public static soundEnable: boolean = true;
    public static volume: number = 1;

    public static firstClick = false;


    // init AudioManager in GameRoot component.
    public static init(audioSource: AudioSource, node?) {
        AudioManager._audioSource = audioSource;
        AudioManager.rootNode = node;
        for (let name in AudioManager.audioSourceMap) {
            const item = AudioManager.audioSourceMap[name];
            item && item.playing && item.audioSource.stop();
        }
        AudioManager.audioSourceMap = {};

        if ('volumeSwitch' in window && window.volumeSwitch !== void 0) {
            console.log('Init AudioManager volumeSwitch', window.volumeSwitch);
            AudioManager.musicEnable = !!window.volumeSwitch;
            AudioManager.soundEnable = !!window.volumeSwitch;
        }
        if (window.__PLATFORM == 'Ironsource' && window['dapi'] && window.dapi['getAudioVolume']) {
            //Ironsource 平台音量
            let vs = window.dapi.getAudioVolume();
            if (vs <= 0) {
                AudioManager.volume = 0;
                AudioManager.musicEnable = false;
                AudioManager.soundEnable = false;
            } else if (typeof vs == 'number') {
                AudioManager.volume = vs / 100;
            }
        }
        console.log('Init AudioManager:', AudioManager.musicEnable, AudioManager.volume);

        game.on(Game.EVENT_HIDE, function () {
            AudioManager.pause();
        });
        game.on(Game.EVENT_SHOW, function () {
            AudioManager.resume();
        });

        view.on("audioVolumeChange", AudioManager.audioVolumeChange, this);
    }

    public static audioVolumeChange(e) {
        console.log('audioVolumeChange event.', e)
        let last = AudioManager.musicEnable;
        AudioManager.musicEnable = e;
        AudioManager.soundEnable = e;
        if (last && !e) {
            AudioManager.pause();
        } else if (!last && e) {
            AudioManager.resume();
        }
        // this.isPlatformPlay = e, t.mute = !e
    }

    public static resume() {
        if (!AudioManager.musicEnable) {
            return;
        }
        const audioSource = AudioManager._audioSource!;
        audioSource.play();

        for (let name in AudioManager.audioSourceMap) {
            const item = AudioManager.audioSourceMap[name];
            item && item.playing && item.audioSource.play();
        }
    }

    public static pause() {
        const audioSource = AudioManager._audioSource!;
        audioSource.pause();

        for (let name in AudioManager.audioSourceMap) {
            const item = AudioManager.audioSourceMap[name];
            item && item.audioSource.pause();
        }
    }

    /**
     * 播放音效
     * @param name 
     */
    public static soundPlay(name: string, volumeScale = 1) {
        if (!AudioManager.soundEnable || !AudioManager.firstClick) {
            return;
        }

        const audioSource = AudioManager._audioSource!;

        let path = AudioManager.basePath + name;
        let cachedAudioClip = AudioManager._cachedAudioClipMap[path];
        if (cachedAudioClip) {
            audioSource.playOneShot(cachedAudioClip, volumeScale);
        } else {
            assetManager.resources?.load(path, AudioClip, (err, clip) => {
                if (err) {
                    console.warn(err);
                    return;
                }

                AudioManager._cachedAudioClipMap[path] = clip;
                audioSource.playOneShot(clip, volumeScale);
            });
        }
    }

    /**
     * 播放背景音乐
     * @param {Boolean} loop 是否循环播放
     */
    public static musicPlay(name: string, loop: boolean) {
        const audioSource = AudioManager._audioSource!;
        if (audioSource.playing) {
            // audioSource.stop();
            return;
        }
        audioSource.loop = loop;

        let path = AudioManager.basePath + name;
        let cachedAudioClip = AudioManager._cachedAudioClipMap[path];
        if (cachedAudioClip) {
            audioSource.clip = cachedAudioClip;
            if (AudioManager.musicEnable) {
                audioSource.play();
            }
            if (!AudioManager.firstClick) {
                audioSource.pause();
            }
        } else {
            assetManager.resources?.load(path, AudioClip, (err, clip) => {
                if (err) {
                    console.warn(err);
                    return;
                }

                AudioManager._cachedAudioClipMap[path] = clip;
                audioSource.clip = clip;

                if (AudioManager.musicEnable) {
                    audioSource.play();
                }
                if (!AudioManager.firstClick) {
                    audioSource.pause();
                }
            });
        }
    }

    public static musicStop() {
        const audioSource = AudioManager._audioSource!;
        audioSource.stop();
    }


    public static audioPlay(name, loop = false, volumeScale?: number) {
        if (!AudioManager.soundEnable || !AudioManager.rootNode || !AudioManager.firstClick) {
            return;
        }
        let item: AudioItem = AudioManager.audioSourceMap[name];
        if (!item) {
            const as = AudioManager.rootNode.addComponent(AudioSource);
            AudioManager.audioSourceMap[name] = { audioSource: as, playing: true };

            let path = AudioManager.basePath + name;
            assetManager.resources?.load(path, AudioClip, (err, clip) => {
                if (err) {
                    console.warn(err);
                    return;
                }

                AudioManager._cachedAudioClipMap[path] = clip;
                as.clip = clip;
                if (loop) {
                    as.loop = true;
                }
                as.volume = volumeScale && !isNaN(volumeScale) ? AudioManager.volume * volumeScale : AudioManager.volume;

                if (AudioManager.musicEnable) {
                    as.play();
                }
                if (!AudioManager.firstClick) {
                    as.pause();
                }
            });
        } else {
            const as = item.audioSource;
            if (loop) {
                as.loop = true;
            }
            as.volume = volumeScale && !isNaN(volumeScale) ? AudioManager.volume * volumeScale : AudioManager.volume;
            if (!as.playing && AudioManager.firstClick) {
                as.play();
            }
        }
    }

    public static audioStop(name) {
        let item: AudioItem = AudioManager.audioSourceMap[name];
        if (item) {
            item.playing = false;
            item.audioSource.stop();
        }
    }

    public static audioPause(name) {
        let item: AudioItem = AudioManager.audioSourceMap[name];
        if (item) {
            item.playing = false;
            item.audioSource.pause();
        }
    }

    public static audioVolume(name, volumeScale: number = 1) {
        let item: AudioItem = AudioManager.audioSourceMap[name];
        if (item) {
            item.audioSource.volume = AudioManager.volume * volumeScale;
        }
    }


    // 设置音乐音量
    public static musicVolumeSet(v: number) {
        const audioSource = AudioManager._audioSource!;
        audioSource.volume = v;
        AudioManager.volume = v;
        sys.localStorage.setItem("volume", String(v));
    }

    public static musicEnableSet(enable: boolean) {
        const audioSource = AudioManager._audioSource!;
        AudioManager.musicEnable = enable;
        sys.localStorage.setItem("musicEnable", enable ? "1" : "0");
        if (enable) {
            if (!audioSource.playing) {
                audioSource.play();
            }
        } else {
            if (audioSource.playing) {
                audioSource.stop();
            }
        }
    }

    public static soundEnableSet(enable: boolean) {
        const audioSource = AudioManager._audioSource!;
        AudioManager.soundEnable = enable;
        sys.localStorage.setItem("soundEnable", enable ? "1" : "0");
    }
}