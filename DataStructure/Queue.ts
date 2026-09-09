class QueueNode<T> {

    private _value: T;

    public get value(): T {
        return this._value;
    }

    public next: QueueNode<T> = null;

    public constructor(value: T) {
        this._value = value;
    }
}

export class Queue<T> {

    private _first: QueueNode<T> = null;

    private _last: QueueNode<T> = null;

    private _count: number = 0;

    public get count(): number {
        return this._count;
    }

    public get isEmpty(): boolean {
        return this._count === 0;
    }

    public enqueue(value: T) {
        const newNode = new QueueNode<T>(value);
        if (this._count === 0) {
            this._first = newNode;
            this._last = newNode;
        }
        else {
            this._last.next = newNode;
            this._last = newNode;
        }
        this._count++;
    }

    public dequeue(): T {
        if (this._count === 0) {
            return null;
        }
        const dequeuedNode = this._first;
        this._first = this._first.next;
        if (this._first == null) {
            this._last = null;
        }
        this._count--;
        return dequeuedNode.value;
    }

    public peek(): T {
        if (this._count === 0) {
            return null;
        }
        return this._first.value;
    }

    public forEach(callback: (value: T, index: number) => void) {
        let currentNode = this._first;
        let index = 0;
        while (currentNode != null) {
            callback(currentNode.value, index);
            currentNode = currentNode.next;
            index++;
        }
    }
}


