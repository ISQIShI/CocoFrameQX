
export interface IClip {
    get isCompleted(): boolean;

    onEnter(): void;

    onUpdate(deltaTime: number): void;

    onExit(): void;
}


