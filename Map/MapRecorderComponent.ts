import { _decorator, CCInteger, Component } from 'cc';
import { MapRecorder } from './MapRecorder';
import { InspectorButton } from '../Utils/InspectorButton';
const { ccclass, property } = _decorator;

@ccclass('Component')
export abstract class MapRecorderComponent<T extends MapRecorder = MapRecorder> extends Component {

    @property({ type: [MapRecorder], tooltip: '地图记录条目', visible: true })
    protected _mapRecorderEntries: T[] = [];


    @InspectorButton("点击添加记录条目")
    protected addEntry() {
        this._mapRecorderEntries.push(this.createMapRecorder());
    }

    @InspectorButton({
        text: "点击移除索引对应的记录条目",
        params: [
            {
                name: "index",
                type: CCInteger,
                min: 0,
                tooltip: "要移除的记录条目的索引"
            }
        ]
    })
    protected removeEntry(index: number) {
        if (index >= 0 && index < this._mapRecorderEntries.length) {
            this._mapRecorderEntries.splice(index, 1);
        }
    }

    protected abstract createMapRecorder(): T;
}

