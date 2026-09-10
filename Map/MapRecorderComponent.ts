import { _decorator, Component } from 'cc';
import { MapRecorder } from './MapRecorder';
const { ccclass, property } = _decorator;

@ccclass('Component')
export abstract class MapRecorderComponent<T extends MapRecorder> extends Component {

    @property({ type: [MapRecorder], tooltip: '地图记录条目', visible: true })
    protected _mapRecorderEntries: T[] = [];

    @property({ displayName: '点击添加记录条目' })
    protected get addEntry(): boolean {
        return false;
    }
    protected set addEntry(value: boolean) {
        if (value) {
            this._mapRecorderEntries.push(this.createMapRecorder());
        }
    }

    protected abstract createMapRecorder(): T;
}

