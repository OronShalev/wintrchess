import os from "os";

import StockfishEngine from "./StockfishEngine";

/**
 * A pre-initialized pool of Stockfish engines that eliminates per-request
 * spawn overhead and manages thread allocation across the available CPU budget.
 */
export class EnginePool {
    private available: StockfishEngine[] = [];
    private waiting: ((engine: StockfishEngine) => void)[] = [];
    private initialized = false;

    constructor(
        private readonly poolSize: number,
        private readonly threadsPerEngine: number,
        private readonly hashSizePerEngine: number
    ) {}

    public async init(): Promise<void> {
        if (this.initialized) return;

        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < this.poolSize; i++) {
            const engine = new StockfishEngine();
            initPromises.push(
                engine.init().then(() => {
                    engine.setThreadCount(this.threadsPerEngine);
                    engine.setHashSize(this.hashSizePerEngine);
                    this.available.push(engine);
                })
            );
        }

        await Promise.all(initPromises);
        this.initialized = true;

        console.log(
            `Engine pool ready: ${this.poolSize} engines × ${this.threadsPerEngine} threads `
            + `(${this.poolSize * this.threadsPerEngine} total threads), ${this.hashSizePerEngine} MB hash each`
        );
    }

    /**
     * Acquire an engine from the pool. Waits if none are available.
     */
    public acquire(): Promise<StockfishEngine> {
        const engine = this.available.pop();
        if (engine) return Promise.resolve(engine);

        return new Promise<StockfishEngine>(resolve => {
            this.waiting.push(resolve);
        });
    }

    /**
     * Release an engine back to the pool.
     */
    public release(engine: StockfishEngine): void {
        const waiter = this.waiting.shift();
        if (waiter) {
            waiter(engine);
        } else {
            this.available.push(engine);
        }
    }

    /**
     * Terminate all engines and reset the pool.
     */
    public terminate(): void {
        for (const engine of this.available) {
            engine.terminate();
        }
        this.available = [];
        this.waiting = [];
        this.initialized = false;
    }

    public get size(): number {
        return this.poolSize;
    }

    public get threads(): number {
        return this.threadsPerEngine;
    }

    public get isInitialized(): boolean {
        return this.initialized;
    }

    public get availableCount(): number {
        return this.available.length;
    }
}

/**
 * Computes optimal pool sizing based on available CPUs and worker count.
 */
export function computePoolConfig(): { poolSize: number; threadsPerEngine: number; hashSizePerEngine: number } {
    const totalCpus = os.availableParallelism();
    const workerCount = parseInt(process.env.WORKER_COUNT || "4");

    // Reserve a fraction of CPUs for Node.js event loops and OS overhead
    const cpuBudget = Math.max(1, Math.floor(totalCpus * 0.9 / workerCount));

    // Determine pool size: more engines = more parallel positions, fewer threads each.
    // Stockfish scales sublinearly with threads, so more engines is often better.
    // Sweet spot: 2-8 threads per engine depending on CPU budget.
    let poolSize: number;
    let threadsPerEngine: number;

    if (cpuBudget >= 32) {
        poolSize = 8;
        threadsPerEngine = Math.floor(cpuBudget / 8);
    } else if (cpuBudget >= 16) {
        poolSize = 4;
        threadsPerEngine = Math.floor(cpuBudget / 4);
    } else if (cpuBudget >= 8) {
        poolSize = 4;
        threadsPerEngine = Math.floor(cpuBudget / 4);
    } else if (cpuBudget >= 4) {
        poolSize = 2;
        threadsPerEngine = Math.floor(cpuBudget / 2);
    } else {
        poolSize = 1;
        threadsPerEngine = Math.max(1, cpuBudget);
    }

    let hashSizePerEngine = 128; // default 128MB per engine if not specified

    // Allow env overrides
    poolSize = parseInt(process.env.ENGINE_POOL_SIZE || String(poolSize));
    threadsPerEngine = parseInt(process.env.ENGINE_THREADS || String(threadsPerEngine));
    hashSizePerEngine = parseInt(process.env.ENGINE_HASH || String(hashSizePerEngine));

    return { poolSize, threadsPerEngine, hashSizePerEngine };
}

// Singleton pool instance for the worker process
let globalPool: EnginePool | null = null;
let globalPoolPromise: Promise<EnginePool> | null = null;

export async function getGlobalPool(): Promise<EnginePool> {
    if (globalPool && globalPool.isInitialized) {
        return globalPool;
    }

    if (!globalPoolPromise) {
        const config = computePoolConfig();
        const pool = new EnginePool(
            config.poolSize,
            config.threadsPerEngine,
            config.hashSizePerEngine
        );
        globalPool = pool;
        globalPoolPromise = pool.init()
            .then(() => pool)
            .catch(error => {
                if (globalPool === pool) globalPool = null;
                globalPoolPromise = null;
                throw error;
            });
    }

    return globalPoolPromise;
}

export default EnginePool;
