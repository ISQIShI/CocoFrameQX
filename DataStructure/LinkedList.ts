class LinkedListNode<T> {

    private _value: T;

    public get value(): T {
        return this._value;
    }

    public previous: LinkedListNode<T> = null;

    public next: LinkedListNode<T> = null;

    public constructor(value: T) {
        this._value = value;
    }
}

export class LinkedList<T> {

    private _first: LinkedListNode<T> = null;

    private _last: LinkedListNode<T> = null;

    private _count: number = 0;

    public get count(): number {
        return this._count;
    }

    public get isEmpty(): boolean {
        return this._count === 0;
    }

    public addLast(value: T) {
        const newNode = new LinkedListNode<T>(value);

        if (this._last) {
            newNode.previous = this._last;
            this._last.next = newNode;
        } else {
            this._first = newNode;
        }

        this._last = newNode;
        this._count++;
    }

    public addFirst(value: T) {
        const newNode = new LinkedListNode<T>(value);
        if (this._first) {
            newNode.next = this._first;
            this._first.previous = newNode;
        } else {
            this._last = newNode;
        }
        this._first = newNode;
        this._count++;
    }

    public removeFirst(): T {
        if (this._first == null) {
            return null;
        }
        const removedNode = this._first;
        this.removeNode(removedNode);
        return removedNode.value;
    }

    public removeLast(): T {
        if (this._last == null) {
            return null;
        }
        const removedNode = this._last;
        this.removeNode(removedNode);
        return removedNode.value;
    }

    public remove(value: T): boolean {
        let currentNode = this._first;

        while (currentNode) {
            if (currentNode.value === value) {
                this.removeNode(currentNode);
                return true;
            }
            currentNode = currentNode.next;
        }

        return false;
    }

    private removeNode(node: LinkedListNode<T>): void {
        if (node.previous) {
            node.previous.next = node.next;
        } else {
            this._first = node.next;
        }

        if (node.next) {
            node.next.previous = node.previous;
        } else {
            this._last = node.previous;
        }

        node.previous = null;
        node.next = null;
        this._count--;
    }

    public forEach(callback: (value: T, index: number) => void) {
        let currentNode = this._first;
        let index = 0;

        while (currentNode) {
            callback(currentNode.value, index);
            currentNode = currentNode.next;
            index++;
        }
    }

}
