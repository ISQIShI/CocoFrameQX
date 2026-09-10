import { Pool, Vec3 } from "cc";

export class GlobalPool {

    private static _vec3Pool: Pool<Vec3>;

    public static get Vec3Pool(): Pool<Vec3> {
        if (!this._vec3Pool) {
            this._vec3Pool = new Pool<Vec3>(() => new Vec3(), 10);
        }
        return this._vec3Pool;
    }
}


