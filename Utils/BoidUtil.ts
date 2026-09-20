import { Vec3, Quat, math } from 'cc';
import { RandomSource } from './RandomUtil';

/**
 * 鸟群算法个体数据接口
 * 工具方法通过该接口读取个体的运动状态（位置、速度等）
 */
export interface IBoidAgent {
    /** 个体当前三维位置（世界坐标或父节点局部坐标，与算法计算空间一致） */
    readonly position: Vec3;
    /** 个体当前三维速度向量 */
    readonly velocity: Vec3;
}

/**
 * 鸟群算法配置参数
 */
export interface IBoidSettings {
    /** 邻域感知半径：在此距离内的同伴被视为邻居，默认 5.0 */
    neighborRadius?: number;
    /** 分离安全半径：在此距离内的同伴会触发排斥避让，必须 <= neighborRadius，默认 1.5 */
    separationRadius?: number;

    /** 最小速度，默认 1.5 */
    minSpeed?: number;
    /** 最大速度，默认 5.0 */
    maxSpeed?: number;
    /** 最大转向力：限制每秒可施加的最大加速度/转向力，默认 8.0 */
    maxForce?: number;

    /** 分离力权重 (Separation)，默认 2.0 */
    separationWeight?: number;
    /** 对齐力权重 (Alignment)，默认 1.0 */
    alignmentWeight?: number;
    /** 聚集力权重 (Cohesion)，默认 1.2 */
    cohesionWeight?: number;

    /** 目标追踪权重 (Seek Target)，默认 1.0 */
    targetWeight?: number;
    /** 威胁逃跑权重 (Flee Threat)，默认 3.5 */
    threatWeight?: number;
    /** 边界限制权重 (Boundary)，默认 4.0 */
    boundaryWeight?: number;
    /** 随机游走扰动权重 (Wander)，默认 0.3 */
    wanderWeight?: number;

    /** 视野角度（度数，例如 270 表示身后有 90 度盲区；360 表示全周无盲区），默认 300 */
    fieldOfView?: number;
}

/**
 * 轴对齐盒形 (AABB) 边界配置
 */
export interface IBoxBounds {
    /** 边界中心点 */
    center: Vec3;
    /** 边界长宽高尺寸 (x: 宽, y: 高, z: 深) */
    size: Vec3;
    /** 软边界缓冲距离：进入此距离内开始产生回推转向力，默认 2.0 */
    margin?: number;
}

/**
 * 球形边界配置
 */
export interface ISphereBounds {
    /** 边界中心点 */
    center: Vec3;
    /** 球体半径 */
    radius: number;
    /** 软边界缓冲距离，默认 2.0 */
    margin?: number;
}

/**
 * 综合转向力计算的上下文环境参数
 */
export interface IBoidSteeringContext {
    /** 盒形边界限制（可选） */
    boxBounds?: IBoxBounds;
    /** 球形边界限制（可选） */
    sphereBounds?: ISphereBounds;
    /** 追踪目标位置（可选） */
    targetPos?: Vec3;
    /** 到达目标的减速半径（默认 0，即全速追逐） */
    targetSlowingRadius?: number;
    /** 威胁/天敌位置（可选） */
    threatPos?: Vec3;
    /** 威胁感知半径（超出此半径不产生逃跑力） */
    threatRadius?: number;
    /** 用于随机游走的扰动向量（内部会被就地更新以保持时间连续性） */
    wanderState?: Vec3;
    /** 随机数生成源（默认 Math.random，可传入确定性伪随机数源） */
    random?: RandomSource;
}

/**
 * 完整的 3D 鸟群/鱼群算法工具类 (Boids Algorithm)
 * 采用纯工具方法形式实现，所有个体状态与环境参数均通过方法参数传递，无内部残留状态。
 * 内部静态复用临时变量，避免在计算高频调用的每帧产生 GC 分配。
 */
export class BoidUtil {
    // ----------------------- 静态临时变量（避免每帧 GC 内存分配） -----------------------
    private static readonly _v1: Vec3 = new Vec3();
    private static readonly _v2: Vec3 = new Vec3();
    private static readonly _v3: Vec3 = new Vec3();
    private static readonly _v4: Vec3 = new Vec3();
    private static readonly _v5: Vec3 = new Vec3();

    private static readonly _tempSeparation: Vec3 = new Vec3();
    private static readonly _tempAlignment: Vec3 = new Vec3();
    private static readonly _tempCohesion: Vec3 = new Vec3();
    private static readonly _tempBoundary: Vec3 = new Vec3();
    private static readonly _tempTarget: Vec3 = new Vec3();
    private static readonly _tempThreat: Vec3 = new Vec3();
    private static readonly _tempWander: Vec3 = new Vec3();

    private static readonly _targetQuat: Quat = new Quat();
    private static readonly _rotDir: Vec3 = new Vec3();

    /**
     * 计算三维向量的截断（将模长限制在 maxLength 以内）
     */
    public static clampVector(v: Vec3, maxLength: number, out: Vec3): Vec3 {
        const sqrMag = v.lengthSqr();
        if (sqrMag > maxLength * maxLength && sqrMag > 0.000001) {
            const mag = Math.sqrt(sqrMag);
            out.set((v.x / mag) * maxLength, (v.y / mag) * maxLength, (v.z / mag) * maxLength);
        } else {
            out.set(v);
        }
        return out;
    }

    /**
     * 将三维向量的模长限制在 [minLength, maxLength] 之间
     */
    public static clampVectorRange(v: Vec3, minLength: number, maxLength: number, out: Vec3): Vec3 {
        const sqrMag = v.lengthSqr();
        if (sqrMag < 0.000001) {
            out.set(0, 0, 0);
            return out;
        }
        const mag = Math.sqrt(sqrMag);
        if (mag < minLength) {
            out.set((v.x / mag) * minLength, (v.y / mag) * minLength, (v.z / mag) * minLength);
        } else if (mag > maxLength) {
            out.set((v.x / mag) * maxLength, (v.y / mag) * maxLength, (v.z / mag) * maxLength);
        } else {
            out.set(v);
        }
        return out;
    }

    /**
     * 判断邻居是否处于个体的视野前方（锥形视野裁切）
     * @param agentPosition 个体位置
     * @param agentVelocity 个体当前速度向量（航向）
     * @param neighborPosition 邻居位置
     * @param fovDegrees 视野总夹角（度数，例如 300）
     */
    public static isInView(
        agentPosition: Vec3,
        agentVelocity: Vec3,
        neighborPosition: Vec3,
        fovDegrees: number = 360
    ): boolean {
        if (fovDegrees >= 360) return true;
        const velSqr = agentVelocity.lengthSqr();
        if (velSqr < 0.0001) return true;

        const toNeighbor = BoidUtil._v1;
        toNeighbor.set(
            neighborPosition.x - agentPosition.x,
            neighborPosition.y - agentPosition.y,
            neighborPosition.z - agentPosition.z
        );
        const distSqr = toNeighbor.lengthSqr();
        if (distSqr < 0.000001) return true;

        toNeighbor.multiplyScalar(1 / Math.sqrt(distSqr));
        const forward = BoidUtil._v2;
        forward.set(agentVelocity).multiplyScalar(1 / Math.sqrt(velSqr));

        const dot = Vec3.dot(forward, toNeighbor);
        const halfFovRad = (fovDegrees * 0.5 * Math.PI) / 180;
        return dot >= Math.cos(halfFovRad);
    }

    /**
     * 1. 计算分离力 (Separation)
     * 避免与距离过近的邻近个体发生碰撞拥挤
     * @param agent 目标个体
     * @param neighbors 邻居群体
     * @param separationRadius 分离安全半径
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     */
    public static calculateSeparation(
        agent: IBoidAgent,
        neighbors: readonly IBoidAgent[],
        separationRadius: number,
        maxSpeed: number,
        maxForce: number,
        out: Vec3
    ): Vec3 {
        out.set(0, 0, 0);
        let count = 0;
        const radiusSqr = separationRadius * separationRadius;
        const diff = BoidUtil._v1;

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (neighbor === agent) continue;

            const dx = agent.position.x - neighbor.position.x;
            const dy = agent.position.y - neighbor.position.y;
            const dz = agent.position.z - neighbor.position.z;
            const distSqr = dx * dx + dy * dy + dz * dz;

            if (distSqr > 0.000001 && distSqr < radiusSqr) {
                const dist = Math.sqrt(distSqr);
                // 距离越近排斥力越大（权重与距离成反比）
                diff.set(dx / dist, dy / dist, dz / dist);
                diff.multiplyScalar(1 / Math.max(dist, 0.01));
                out.add(diff);
                count++;
            }
        }

        if (count > 0) {
            out.multiplyScalar(1 / count);
            const len = out.length();
            if (len > 0.0001) {
                // Reynolds 转向模型: Steering = Desired - Velocity
                out.multiplyScalar(maxSpeed / len);
                out.subtract(agent.velocity);
                BoidUtil.clampVector(out, maxForce, out);
            }
        }
        return out;
    }

    /**
     * 2. 计算对齐力 (Alignment)
     * 匹配邻居个体的平均航向与移动速度
     * @param agent 目标个体
     * @param neighbors 邻居群体
     * @param neighborRadius 感知半径
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     * @param fovDegrees 视野角度 (默认 300)
     */
    public static calculateAlignment(
        agent: IBoidAgent,
        neighbors: readonly IBoidAgent[],
        neighborRadius: number,
        maxSpeed: number,
        maxForce: number,
        out: Vec3,
        fovDegrees: number = 300
    ): Vec3 {
        out.set(0, 0, 0);
        let count = 0;
        const radiusSqr = neighborRadius * neighborRadius;

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (neighbor === agent) continue;

            const dx = neighbor.position.x - agent.position.x;
            const dy = neighbor.position.y - agent.position.y;
            const dz = neighbor.position.z - agent.position.z;
            const distSqr = dx * dx + dy * dy + dz * dz;

            if (distSqr > 0.000001 && distSqr < radiusSqr) {
                if (BoidUtil.isInView(agent.position, agent.velocity, neighbor.position, fovDegrees)) {
                    out.add(neighbor.velocity);
                    count++;
                }
            }
        }

        if (count > 0) {
            out.multiplyScalar(1 / count);
            const len = out.length();
            if (len > 0.0001) {
                // 期望速度为邻居平均速度的方向乘以最大速度
                out.multiplyScalar(maxSpeed / len);
                out.subtract(agent.velocity);
                BoidUtil.clampVector(out, maxForce, out);
            }
        }
        return out;
    }

    /**
     * 3. 计算凝聚力 (Cohesion)
     * 促使个体向附近邻居的质心（群体中心）靠拢
     * @param agent 目标个体
     * @param neighbors 邻居群体
     * @param neighborRadius 感知半径
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     * @param fovDegrees 视野角度 (默认 300)
     */
    public static calculateCohesion(
        agent: IBoidAgent,
        neighbors: readonly IBoidAgent[],
        neighborRadius: number,
        maxSpeed: number,
        maxForce: number,
        out: Vec3,
        fovDegrees: number = 300
    ): Vec3 {
        out.set(0, 0, 0);
        let count = 0;
        const radiusSqr = neighborRadius * neighborRadius;
        const center = BoidUtil._v1;
        center.set(0, 0, 0);

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (neighbor === agent) continue;

            const dx = neighbor.position.x - agent.position.x;
            const dy = neighbor.position.y - agent.position.y;
            const dz = neighbor.position.z - agent.position.z;
            const distSqr = dx * dx + dy * dy + dz * dz;

            if (distSqr > 0.000001 && distSqr < radiusSqr) {
                if (BoidUtil.isInView(agent.position, agent.velocity, neighbor.position, fovDegrees)) {
                    center.add(neighbor.position);
                    count++;
                }
            }
        }

        if (count > 0) {
            center.multiplyScalar(1 / count);
            return BoidUtil.calculateSeek(agent.position, agent.velocity, center, maxSpeed, maxForce, out);
        }
        return out;
    }

    /**
     * 4. 计算目标追踪转向力 (Seek / Arrival)
     * @param currentPos 当前位置
     * @param currentVel 当前速度
     * @param targetPos 目标位置
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     * @param slowingRadius 减速缓冲区半径（若 > 0 则在接近目标时平滑减速）
     */
    public static calculateSeek(
        currentPos: Vec3,
        currentVel: Vec3,
        targetPos: Vec3,
        maxSpeed: number,
        maxForce: number,
        out: Vec3,
        slowingRadius: number = 0
    ): Vec3 {
        out.set(targetPos.x - currentPos.x, targetPos.y - currentPos.y, targetPos.z - currentPos.z);
        const dist = out.length();

        if (dist > 0.0001) {
            let desiredSpeed = maxSpeed;
            if (slowingRadius > 0 && dist < slowingRadius) {
                desiredSpeed = maxSpeed * (dist / slowingRadius);
            }
            out.multiplyScalar(desiredSpeed / dist);
            out.subtract(currentVel);
            BoidUtil.clampVector(out, maxForce, out);
        } else {
            out.set(0, 0, 0);
        }
        return out;
    }

    /**
     * 5. 计算避开威胁/天敌转向力 (Flee)
     * @param currentPos 当前位置
     * @param currentVel 当前速度
     * @param threatPos 威胁点位置
     * @param threatRadius 威胁感应半径
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     */
    public static calculateFlee(
        currentPos: Vec3,
        currentVel: Vec3,
        threatPos: Vec3,
        threatRadius: number,
        maxSpeed: number,
        maxForce: number,
        out: Vec3
    ): Vec3 {
        out.set(currentPos.x - threatPos.x, currentPos.y - threatPos.y, currentPos.z - threatPos.z);
        const dist = out.length();

        if (dist > 0.0001 && dist < threatRadius) {
            out.multiplyScalar(maxSpeed / dist);
            out.subtract(currentVel);
            // 距离越近逃离意图越强烈
            const factor = 1 - dist / threatRadius;
            out.multiplyScalar(1 + factor);
            BoidUtil.clampVector(out, maxForce, out);
        } else {
            out.set(0, 0, 0);
        }
        return out;
    }

    /**
     * 6. 计算立方体 (AABB) 软/硬边界回推力
     * @param currentPos 当前位置
     * @param currentVel 当前速度
     * @param bounds 盒形边界
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     */
    public static calculateBoxBoundary(
        currentPos: Vec3,
        currentVel: Vec3,
        bounds: IBoxBounds,
        maxSpeed: number,
        maxForce: number,
        out: Vec3
    ): Vec3 {
        out.set(0, 0, 0);
        const margin = Math.max(0.1, bounds.margin ?? 2.0);
        const halfX = Math.abs(bounds.size.x) * 0.5;
        const halfY = Math.abs(bounds.size.y) * 0.5;
        const halfZ = Math.abs(bounds.size.z) * 0.5;

        const minX = bounds.center.x - halfX;
        const maxX = bounds.center.x + halfX;
        const minY = bounds.center.y - halfY;
        const maxY = bounds.center.y + halfY;
        const minZ = bounds.center.z - halfZ;
        const maxZ = bounds.center.z + halfZ;

        // X 轴边界
        if (currentPos.x < minX + margin) {
            const factor = math.clamp01((minX + margin - currentPos.x) / margin);
            out.x = maxSpeed * (factor * 0.8 + 0.2);
        } else if (currentPos.x > maxX - margin) {
            const factor = math.clamp01((currentPos.x - (maxX - margin)) / margin);
            out.x = -maxSpeed * (factor * 0.8 + 0.2);
        }

        // Y 轴边界
        if (currentPos.y < minY + margin) {
            const factor = math.clamp01((minY + margin - currentPos.y) / margin);
            out.y = maxSpeed * (factor * 0.8 + 0.2);
        } else if (currentPos.y > maxY - margin) {
            const factor = math.clamp01((currentPos.y - (maxY - margin)) / margin);
            out.y = -maxSpeed * (factor * 0.8 + 0.2);
        }

        // Z 轴边界
        if (currentPos.z < minZ + margin) {
            const factor = math.clamp01((minZ + margin - currentPos.z) / margin);
            out.z = maxSpeed * (factor * 0.8 + 0.2);
        } else if (currentPos.z > maxZ - margin) {
            const factor = math.clamp01((currentPos.z - (maxZ - margin)) / margin);
            out.z = -maxSpeed * (factor * 0.8 + 0.2);
        }

        const len = out.length();
        if (len > 0.0001) {
            out.multiplyScalar(maxSpeed / len);
            out.subtract(currentVel);
            BoidUtil.clampVector(out, maxForce, out);
        }
        return out;
    }

    /**
     * 7. 计算球形边界回推力
     * @param currentPos 当前位置
     * @param currentVel 当前速度
     * @param bounds 球形边界
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param out 输出结果转向力
     */
    public static calculateSphereBoundary(
        currentPos: Vec3,
        currentVel: Vec3,
        bounds: ISphereBounds,
        maxSpeed: number,
        maxForce: number,
        out: Vec3
    ): Vec3 {
        out.set(0, 0, 0);
        const margin = Math.max(0.1, bounds.margin ?? 2.0);
        const dx = currentPos.x - bounds.center.x;
        const dy = currentPos.y - bounds.center.y;
        const dz = currentPos.z - bounds.center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const innerRadius = Math.max(0, bounds.radius - margin);

        if (dist > innerRadius && dist > 0.0001) {
            // 超出或接近球体边缘，产生指向球心的力
            const factor = math.clamp01((dist - innerRadius) / margin);
            out.set(-dx / dist, -dy / dist, -dz / dist);
            out.multiplyScalar(maxSpeed * (factor * 0.8 + 0.2));
            out.subtract(currentVel);
            BoidUtil.clampVector(out, maxForce, out);
        }
        return out;
    }

    /**
     * 8. 计算自然随机游走力 (Reynolds Wander)
     * 在当前速度前方投影一个小虚拟球，在其表面进行小幅度平滑抖动，形成真实自然的巡游偏航
     * @param currentVelocity 当前速度向量
     * @param wanderState 累积的游走方向（会在方法内部被就地平滑更新）
     * @param wanderRadius 游走球半径（默认 1.2）
     * @param wanderDistance 游走球距离（默认 2.0）
     * @param wanderJitter 抖动幅度（默认 0.5）
     * @param maxSpeed 最大速度
     * @param maxForce 最大转向力
     * @param random 随机数生成源（默认 Math.random）
     * @param out 输出结果转向力
     */
    public static calculateWander(
        currentVelocity: Vec3,
        wanderState: Vec3,
        wanderRadius: number = 1.2,
        wanderDistance: number = 2.0,
        wanderJitter: number = 0.5,
        maxSpeed: number = 5.0,
        maxForce: number = 8.0,
        random: RandomSource = Math.random,
        out: Vec3 = new Vec3()
    ): Vec3 {
        // 向现有游走状态添加随机微小位移
        wanderState.x += (random() * 2 - 1) * wanderJitter;
        wanderState.y += (random() * 2 - 1) * wanderJitter;
        wanderState.z += (random() * 2 - 1) * wanderJitter;

        const stateLen = wanderState.length();
        if (stateLen > 0.0001) {
            wanderState.multiplyScalar(wanderRadius / stateLen);
        } else {
            wanderState.set(0, 0, wanderRadius);
        }

        const velLen = currentVelocity.length();
        const forward = BoidUtil._v1;
        if (velLen > 0.0001) {
            forward.set(currentVelocity).multiplyScalar(1 / velLen);
        } else {
            forward.set(0, 0, 1);
        }

        // 目标点 = 速度前方 * wanderDistance + wanderState
        out.set(
            forward.x * wanderDistance + wanderState.x,
            forward.y * wanderDistance + wanderState.y,
            forward.z * wanderDistance + wanderState.z
        );

        const outLen = out.length();
        if (outLen > 0.0001) {
            out.multiplyScalar(maxSpeed / outLen);
            out.subtract(currentVelocity);
            BoidUtil.clampVector(out, maxForce, out);
        }
        return out;
    }

    /**
     * 高性能综合转向力计算 (Combined Steering)
     * 单次遍历邻居列表同时完成分离、对齐、凝聚计算，结合边界、目标、威胁及游走力，
     * 并按权重叠加，最后截断在 maxForce 范围内返回。
     * @param agent 当前个体
     * @param neighbors 所有的个体列表
     * @param settings 鸟群算法权重及速度设置
     * @param context 环境上下文（边界、目标、威胁、随机源等）
     * @param out 输出结果转向力
     */
    public static calculateCombinedSteering(
        agent: IBoidAgent,
        neighbors: readonly IBoidAgent[],
        settings: IBoidSettings,
        context: IBoidSteeringContext = {},
        out: Vec3 = new Vec3()
    ): Vec3 {
        out.set(0, 0, 0);

        const neighborRadius = settings.neighborRadius ?? 5.0;
        const separationRadius = settings.separationRadius ?? 1.5;
        const maxSpeed = settings.maxSpeed ?? 5.0;
        const maxForce = settings.maxForce ?? 8.0;

        const sepWeight = settings.separationWeight ?? 2.0;
        const alignWeight = settings.alignmentWeight ?? 1.0;
        const cohWeight = settings.cohesionWeight ?? 1.2;
        const boundaryWeight = settings.boundaryWeight ?? 4.0;
        const targetWeight = settings.targetWeight ?? 1.0;
        const threatWeight = settings.threatWeight ?? 3.5;
        const wanderWeight = settings.wanderWeight ?? 0.3;
        const fov = settings.fieldOfView ?? 300;

        // 准备分离、对齐、凝聚统计累加器
        const sepAccum = BoidUtil._tempSeparation;
        const alignAccum = BoidUtil._tempAlignment;
        const cohCenter = BoidUtil._tempCohesion;
        sepAccum.set(0, 0, 0);
        alignAccum.set(0, 0, 0);
        cohCenter.set(0, 0, 0);

        let sepCount = 0;
        let flockCount = 0;

        const sepRadiusSqr = separationRadius * separationRadius;
        const neighborRadiusSqr = neighborRadius * neighborRadius;

        const diff = BoidUtil._v1;

        // 单次循环同时计算分离、对齐、凝聚
        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i];
            if (neighbor === agent) continue;

            const dx = neighbor.position.x - agent.position.x;
            const dy = neighbor.position.y - agent.position.y;
            const dz = neighbor.position.z - agent.position.z;
            const distSqr = dx * dx + dy * dy + dz * dz;

            // 1. 分离（近距离排斥，全向 360 度感知，不应有盲区以防背后撞击）
            if (distSqr > 0.000001 && distSqr < sepRadiusSqr) {
                const dist = Math.sqrt(distSqr);
                diff.set(-dx / dist, -dy / dist, -dz / dist);
                diff.multiplyScalar(1 / Math.max(dist, 0.01));
                sepAccum.add(diff);
                sepCount++;
            }

            // 2. 对齐与凝聚（仅考虑视野范围内的邻居）
            if (distSqr > 0.000001 && distSqr < neighborRadiusSqr) {
                if (BoidUtil.isInView(agent.position, agent.velocity, neighbor.position, fov)) {
                    alignAccum.add(neighbor.velocity);
                    cohCenter.add(neighbor.position);
                    flockCount++;
                }
            }
        }

        // 分离力 Steering
        if (sepCount > 0 && sepWeight > 0) {
            sepAccum.multiplyScalar(1 / sepCount);
            const len = sepAccum.length();
            if (len > 0.0001) {
                sepAccum.multiplyScalar(maxSpeed / len);
                sepAccum.subtract(agent.velocity);
                BoidUtil.clampVector(sepAccum, maxForce, sepAccum);
                out.add(sepAccum.multiplyScalar(sepWeight));
            }
        }

        // 对齐力 Steering
        if (flockCount > 0 && alignWeight > 0) {
            alignAccum.multiplyScalar(1 / flockCount);
            const len = alignAccum.length();
            if (len > 0.0001) {
                alignAccum.multiplyScalar(maxSpeed / len);
                alignAccum.subtract(agent.velocity);
                BoidUtil.clampVector(alignAccum, maxForce, alignAccum);
                out.add(alignAccum.multiplyScalar(alignWeight));
            }
        }

        // 凝聚力 Steering
        if (flockCount > 0 && cohWeight > 0) {
            cohCenter.multiplyScalar(1 / flockCount);
            const seekForce = BoidUtil.calculateSeek(agent.position, agent.velocity, cohCenter, maxSpeed, maxForce, BoidUtil._v2);
            out.add(seekForce.multiplyScalar(cohWeight));
        }

        // 边界限制力 (Box / Sphere)
        if (boundaryWeight > 0) {
            if (context.boxBounds) {
                const boxForce = BoidUtil.calculateBoxBoundary(
                    agent.position,
                    agent.velocity,
                    context.boxBounds,
                    maxSpeed,
                    maxForce,
                    BoidUtil._tempBoundary
                );
                out.add(boxForce.multiplyScalar(boundaryWeight));
            }
            if (context.sphereBounds) {
                const sphereForce = BoidUtil.calculateSphereBoundary(
                    agent.position,
                    agent.velocity,
                    context.sphereBounds,
                    maxSpeed,
                    maxForce,
                    BoidUtil._tempBoundary
                );
                out.add(sphereForce.multiplyScalar(boundaryWeight));
            }
        }

        // 目标追踪力 (Seek Target)
        if (context.targetPos && targetWeight > 0) {
            const targetForce = BoidUtil.calculateSeek(
                agent.position,
                agent.velocity,
                context.targetPos,
                maxSpeed,
                maxForce,
                BoidUtil._tempTarget,
                context.targetSlowingRadius ?? 0
            );
            out.add(targetForce.multiplyScalar(targetWeight));
        }

        // 逃跑力 (Flee Threat)
        if (context.threatPos && threatWeight > 0 && (context.threatRadius ?? 0) > 0) {
            const threatForce = BoidUtil.calculateFlee(
                agent.position,
                agent.velocity,
                context.threatPos,
                context.threatRadius!,
                maxSpeed,
                maxForce,
                BoidUtil._tempThreat
            );
            out.add(threatForce.multiplyScalar(threatWeight));
        }

        // 随机巡游扰动力 (Wander)
        if (wanderWeight > 0 && context.wanderState) {
            const wanderForce = BoidUtil.calculateWander(
                agent.velocity,
                context.wanderState,
                1.5,
                2.5,
                0.6,
                maxSpeed,
                maxForce,
                context.random ?? Math.random,
                BoidUtil._tempWander
            );
            out.add(wanderForce.multiplyScalar(wanderWeight));
        }

        // 截断最终总转向力
        BoidUtil.clampVector(out, maxForce, out);
        return out;
    }

    /**
     * 根据转向力与时间步进计算新的速度 (Step Velocity)
     * @param currentVelocity 当前速度
     * @param steeringForce 计算得到的转向力/加速度
     * @param dt 帧间隔时间 (秒)
     * @param minSpeed 最小运动速度
     * @param maxSpeed 最大运动速度
     * @param out 输出新的速度向量
     */
    public static stepVelocity(
        currentVelocity: Vec3,
        steeringForce: Vec3,
        dt: number,
        minSpeed: number,
        maxSpeed: number,
        out: Vec3
    ): Vec3 {
        out.set(
            currentVelocity.x + steeringForce.x * dt,
            currentVelocity.y + steeringForce.y * dt,
            currentVelocity.z + steeringForce.z * dt
        );
        BoidUtil.clampVectorRange(out, minSpeed, maxSpeed, out);
        return out;
    }

    /**
     * 根据速度与时间步进计算新的位置 (Step Position)
     * @param currentPosition 当前位置
     * @param velocity 速度向量
     * @param dt 帧间隔时间 (秒)
     * @param out 输出新的位置
     */
    public static stepPosition(currentPosition: Vec3, velocity: Vec3, dt: number, out: Vec3): Vec3 {
        out.set(
            currentPosition.x + velocity.x * dt,
            currentPosition.y + velocity.y * dt,
            currentPosition.z + velocity.z * dt
        );
        return out;
    }

    /**
     * 根据当前运动速度计算 3D 旋转姿态并进行平滑插值 (Calculate Rotation)
     * @param currentRotation 当前四元数旋转
     * @param velocity 当前移动速度向量
     * @param dt 帧间隔时间 (秒)
     * @param rotationSpeed 转向平滑速度 (例如 5.0，越大响应越快)
     * @param modelForward 模型本身的前向基准向量 (Cocos 规范默认 (0, 0, -1)；若模型前向为 +Z 则传入 (0, 0, 1))
     * @param out 输出平滑旋转后的四元数
     */
    public static calculateRotation(
        currentRotation: Quat,
        velocity: Vec3,
        dt: number,
        rotationSpeed: number = 6.0,
        modelForward: Vec3 = Vec3.FORWARD,
        out: Quat = new Quat()
    ): Quat {
        const velLen = velocity.length();
        if (velLen < 0.001) {
            out.set(currentRotation);
            return out;
        }

        const dir = BoidUtil._rotDir;
        dir.set(velocity.x / velLen, velocity.y / velLen, velocity.z / velLen);

        // 选择合适的上向量（当垂直向上或向下游动时动态切换，避免万向节锁）
        const up = Math.abs(dir.y) > 0.98 ? Vec3.FORWARD : Vec3.UP;

        // 若 modelForward 是 -Z 轴 (Cocos 默认前向 (0, 0, -1))
        if (modelForward.z < -0.9) {
            Quat.fromViewUp(BoidUtil._targetQuat, dir, up);
        } else {
            // 任意前向向量：通过 rotationTo 计算旋转差
            const normFwd = BoidUtil._v4;
            normFwd.set(modelForward).normalize();
            Quat.rotationTo(BoidUtil._targetQuat, normFwd, dir);
        }

        // 平滑插值 (Slerp)
        const t = Math.min(1.0, rotationSpeed * dt);
        Quat.slerp(out, currentRotation, BoidUtil._targetQuat, t);
        return out;
    }
}
