
export class Stack<T> {

    private _elements: T[] = [];

    public get count(): number {
        return this._elements.length;
    }

    public get isEmpty(): boolean {
        return this._elements.length === 0;
    }

    public push(element: T): void {
        this._elements.push(element);
    }

    public pop(): T {
        if (this.isEmpty) {
            return null;
        }
        return this._elements.pop();
    }

    public peek(): T {
        if (this.isEmpty) {
            return null;
        }
        return this._elements[this._elements.length - 1];
    }

    public forEach(callback: (element: T, index: number) => void): void {
        for (let i = this._elements.length - 1; i >= 0; i--) {
            callback(this._elements[i], i);
        }
    }
}


