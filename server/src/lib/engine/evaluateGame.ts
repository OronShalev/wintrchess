import { StateTreeNode, getNodeChain } from "shared/types/game/position/StateTreeNode";
import { GameAnalysis } from "shared/types/game/GameAnalysis";
import AnalysisOptions from "shared/lib/reporter/types/AnalysisOptions";
import { getGameAnalysis } from "shared/lib/reporter/report";
import { STARTING_FEN } from "shared/constants/utils";
import StockfishEngine from "./StockfishEngine";
import { getGlobalPool } from "./EnginePool";

export interface EvaluateGameOptions {
    initialPosition?: string;
    depth?: number;
    lines?: number;
    threads?: number;
    timeLimit?: number; // In seconds
    analysisOptions?: AnalysisOptions;
    onProgress?: (progress: number) => void;
    abortSignal?: AbortSignal;
}

export async function evaluateGameOnServer(
    rootNode: StateTreeNode,
    options: EvaluateGameOptions = {}
): Promise<GameAnalysis> {
    const depth = options.depth || 16;
    const lines = options.lines || 2;
    const timeLimitMs = options.timeLimit ? options.timeLimit * 1000 : undefined;
    const initialPosition = options.initialPosition || STARTING_FEN;

    const nodes = getNodeChain(rootNode);
    const nodesToEvaluate = nodes
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => !node.state.engineLines || node.state.engineLines.length == 0);

    if (nodesToEvaluate.length === 0) {
        options.onProgress?.(1);
        return getGameAnalysis(rootNode, options.analysisOptions);
    }

    const pool = await getGlobalPool();
    let nextNodeIndex = 0;
    let completedNodeCount = nodes.length - nodesToEvaluate.length;

    if (options.abortSignal?.aborted) throw new Error("Evaluation aborted");

    // Determine concurrency: use as many engines as the pool has (or fewer if game is short)
    const concurrency = Math.min(pool.size, nodesToEvaluate.length);

    let activeProgress = 0;
    let lastReportedPercent = -1;
    const reportProgress = () => {
        const percent = Math.min(
            100,
            Math.floor(((completedNodeCount + activeProgress) / nodes.length) * 100)
        );
        if (percent <= lastReportedPercent) return;

        lastReportedPercent = percent;
        options.onProgress?.(percent / 100);
    };

    if (completedNodeCount > 0) {
        reportProgress();
    }

    const acquiredEngines: StockfishEngine[] = [];

    const onAbort = () => {
        // On abort, release all acquired engines back to the pool
        for (const engine of acquiredEngines) {
            try { engine.sendCommand("stop"); } catch { /* ignore */ }
            pool.release(engine);
        }
        acquiredEngines.length = 0;
    };

    try {
        options.abortSignal?.addEventListener("abort", onAbort, { once: true });

        // Acquire engines from pool
        for (let i = 0; i < concurrency; i++) {
            if (options.abortSignal?.aborted) throw new Error("Evaluation aborted");
            const engine = await pool.acquire();
            acquiredEngines.push(engine);
        }

        // Track partial depth progress for all nodes currently being evaluated
        const localProgresses = new Map<number, number>();

        const evaluateNextNode = async (engine: StockfishEngine) => {
            while (true) {
                if (options.abortSignal?.aborted) throw new Error("Evaluation aborted");

                const current = nodesToEvaluate[nextNodeIndex++];
                if (!current) return;

                const moveSequence = nodes
                    .slice(0, current.index + 1)
                    .filter(node => node.state.move)
                    .map(node => node.state.move!.uci);

                engine.setPosition(initialPosition, moveSequence, current.node.state.fen);

                current.node.state.engineLines = await engine.evaluate({
                    depth,
                    lines,
                    timeLimit: timeLimitMs,
                    onEngineLine: line => {
                        const localProgress = line.depth === 0 ? 1 : line.depth / depth;
                        const previousProgress = localProgresses.get(current.index) || 0;
                        const nextProgress = Math.max(previousProgress, localProgress);

                        if (nextProgress > previousProgress) {
                            localProgresses.set(current.index, nextProgress);
                            activeProgress += nextProgress - previousProgress;
                            reportProgress();
                        }
                    }
                });

                activeProgress -= localProgresses.get(current.index) || 0;
                localProgresses.delete(current.index);

                if (options.abortSignal?.aborted) throw new Error("Evaluation aborted");

                completedNodeCount++;
                reportProgress();
            }
        };

        await Promise.all(acquiredEngines.map(evaluateNextNode));
    } finally {
        options.abortSignal?.removeEventListener("abort", onAbort);

        // Release all engines back to the pool
        for (const engine of acquiredEngines) {
            pool.release(engine);
        }
        acquiredEngines.length = 0;
    }

    // Now run full classification and accuracy calculation
    const gameAnalysis = getGameAnalysis(rootNode, options.analysisOptions);
    return gameAnalysis;
}

export default evaluateGameOnServer;
