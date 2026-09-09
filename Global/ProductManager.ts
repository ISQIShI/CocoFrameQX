import { _decorator, CCInteger, Constructor, instantiate, Prefab } from 'cc';
import { Queue } from '../DataStructure/Queue';
import { Product } from '../Product/Product';
import { ComponentSingletonBase } from '../Singleton/ComponentSingletonBase';
const { ccclass, property } = _decorator;

type ProductConstructor<T extends Product> = Constructor<T>;

@ccclass('ProductManager')
export abstract class ProductManager<T extends Product> extends ComponentSingletonBase {
    @property({ type: Prefab, visible: true })
    protected _productPrefab: Prefab;

    @property({ type: CCInteger, min: 0, tooltip: '缓存产品数量' })
    public cachedProductCount = 20;

    protected _productQueue: Queue<T> = new Queue<T>();

    protected abstract get productConstructor(): ProductConstructor<T>;

    public getProduct(): T {
        if (this._productQueue.isEmpty) {
            const productNode = instantiate(this._productPrefab);
            productNode.setParent(this.node, true);
            const product: T = productNode.getComponent(this.productConstructor);
            if (!product) {
                productNode.destroy();
                console.error('产品预制体缺少对应的 Product 组件');
            }
            return product;
        }
        const product = this._productQueue.dequeue();
        product.node.active = true;
        return product;
    }

    public returnProduct(product: T): void {
        if (this._productQueue.count < this.cachedProductCount) {
            product.node.active = false;
            product.node.setParent(this.node, true);
            this._productQueue.enqueue(product);
        }
        else {
            product.node.destroy();
        }
    }
}


