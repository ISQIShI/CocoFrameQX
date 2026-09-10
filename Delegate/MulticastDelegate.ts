export type AnyFunction = (...args: any[]) => any;

interface DelegateEntry<T extends AnyFunction> {
    handler: T;
    target?: any;
}

export class MulticastDelegate<T extends (...args: any[]) => any> {
    private _invocations: DelegateEntry<T>[] = [];

    /**
     * 获取当前挂载的回调数量
     */
    public get count(): number {
        return this._invocations.length;
    }

    /**
     * 是否为空委托
     */
    public get isEmpty(): boolean {
        return this._invocations.length === 0;
    }

    /**
     * 添加回调
     * @param handler 目标函数
     * @param target 执行上下文 
     */
    public add(handler: T, target?: any): this {
        this._invocations.push({ handler, target });
        return this;
    }

    /**
     * 移除回调
     * 从后往前查找并移除最近匹配的一个项
     * @param handler 目标函数
     * @param target 执行上下文
     */
    public remove(handler: T, target?: any): boolean {
        for (let i = this._invocations.length - 1; i >= 0; i--) {
            const entry = this._invocations[i];
            if (entry.handler === handler && entry.target === target) {
                this._invocations.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    /**
     * 触发调用
     * 返回最后一个执行的方法的结果，若为空委托则返回 undefined
     */
    public invoke(...args: Parameters<T>): ReturnType<T> | undefined {
        if (this._invocations.length === 0) {
            return undefined;
        }

        let lastResult: ReturnType<T> | undefined;

        // 做浅拷贝快照，防止在遍历执行中某个函数执行 remove/add 导致迭代器索引错乱
        const listSnapshot = [...this._invocations];
        for (let i = 0; i < listSnapshot.length; i++) {
            const { handler, target } = listSnapshot[i];
            lastResult = handler.apply(target, args);
        }

        return lastResult;
    }

    /**
     * 扩展方法：收集所有被调用方法的执行结果数组
     */
    public invokeAll(...args: Parameters<T>): ReturnType<T>[] {
        const results: ReturnType<T>[] = [];
        const listSnapshot = [...this._invocations];
        for (let i = 0; i < listSnapshot.length; i++) {
            const { handler, target } = listSnapshot[i];
            results.push(handler.apply(target, args));
        }
        return results;
    }

    /**
     * 对应 C# 的 Delegate.GetInvocationList()
     */
    public getInvocationList(): ReadonlyArray<DelegateEntry<T>> {
        return [...this._invocations];
    }

    /**
     * 清空所有绑定的方法
     */
    public clear(): void {
        this._invocations.length = 0;
    }
}