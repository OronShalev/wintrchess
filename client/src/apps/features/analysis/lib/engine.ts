import { EngineLine } from "shared/types/game/position/EngineLine";
import { STARTING_FEN } from "shared/constants/utils";
import apiUrl from "@/constants/apiUrl";

class Engine {
    private position = STARTING_FEN;
    private uciMoves: string[] = [];
    private lineCount = 1;
    private abortController: AbortController | null = null;

    terminate() {
        this.stopEvaluation();
    }

    setLineCount(lines: number) {
        this.lineCount = lines;

        return this;
    }

    setPosition(fen: string, uciMoves?: string[]) {
        this.position = fen;
        this.uciMoves = uciMoves || [];

        return this;
    }

    async evaluate(options: {
        depth: number;
        timeLimit?: number;
        onEngineLine?: (line: EngineLine) => void;
    }): Promise<EngineLine[]> {
        this.abortController = new AbortController();

        const engineLines: EngineLine[] = [];

        try {
            const response = await fetch(apiUrl("/api/analysis/engine/evaluate"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream"
                },
                body: JSON.stringify({
                    fen: this.position,
                    moves: this.uciMoves,
                    depth: options.depth,
                    lines: this.lineCount,
                    timeLimit: options.timeLimit ? options.timeLimit / 1000 : undefined
                }),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Server evaluation error: ${response.statusText}`);
            }

            if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split("\n\n");
                    buffer = parts.pop() || "";

                    for (const part of parts) {
                        for (const rawLine of part.split("\n")) {
                            if (rawLine.startsWith("data: ")) {
                                try {
                                    const parsed = JSON.parse(rawLine.slice(6));
                                    if (parsed.depth !== undefined && parsed.moves) {
                                        const line = parsed as EngineLine;
                                        engineLines.push(line);
                                        options.onEngineLine?.(line);
                                    } else if (parsed.lines) {
                                        return parsed.lines as EngineLine[];
                                    }
                                } catch {
                                    // Ignore parse errors on partial streams
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name === "AbortError") return engineLines;
            throw err;
        }

        return engineLines;
    }

    async stopEvaluation() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

export default Engine;