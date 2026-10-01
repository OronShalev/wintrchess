import AnalysedGame from "shared/types/game/AnalysedGame";
import { StateTreeNode, getNodeChain, serializeNode, deserializeNode } from "shared/types/game/position/StateTreeNode";

interface EvaluateMovesOptions {
    engineDepth: number;
    engineTimeLimit?: number;
    lines: number;
    onProgress?: (progress: number) => void;
}

interface EvaluationProcess {
    evaluate: () => Promise<StateTreeNode[]>;
    controller: AbortController;
}

function createGameEvaluator(
    game: AnalysedGame,
    options: EvaluateMovesOptions
): EvaluationProcess {
    const controller = new AbortController();
    const stateTreeNodes = getNodeChain(game.stateTree);

    async function evaluator(): Promise<StateTreeNode[]> {
        const response = await fetch("/api/analysis/analyse", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream"
            },
            body: JSON.stringify({
                stateTree: serializeNode(game.stateTree),
                depth: options.engineDepth,
                lines: options.lines,
                timeLimit: options.engineTimeLimit,
                initialPosition: game.initialPosition
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Server analysis failed: ${response.statusText}`);
        }

        if (!response.body) return stateTreeNodes;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n\n");
                buffer = parts.pop() || "";

                for (const part of parts) {
                    const data = part.split("\n")
                        .find(line => line.startsWith("data: "));
                    if (!data) continue;

                    try {
                        const parsed = JSON.parse(data.slice(6));
                        if (parsed.type === "progress") {
                            options.onProgress?.(parsed.progress);
                        } else if (parsed.type === "complete" && parsed.gameAnalysis) {
                            const returnedTree = deserializeNode(parsed.gameAnalysis.stateTree);
                            const returnedNodes = getNodeChain(returnedTree);

                            for (let index = 0; index < stateTreeNodes.length && index < returnedNodes.length; index++) {
                                stateTreeNodes[index].state.engineLines = returnedNodes[index].state.engineLines;
                                stateTreeNodes[index].state.classification = returnedNodes[index].state.classification;
                                stateTreeNodes[index].state.accuracy = returnedNodes[index].state.accuracy;
                                stateTreeNodes[index].state.opening = returnedNodes[index].state.opening;
                            }

                            options.onProgress?.(1);
                            return stateTreeNodes;
                        }
                    } catch {
                        // Ignore malformed or incomplete stream events.
                    }
                }
            }
        } catch (error) {
            if (controller.signal.aborted) throw "abort";
            throw error;
        }

        return stateTreeNodes;
    }

    return { evaluate: evaluator, controller };
}

export default createGameEvaluator;