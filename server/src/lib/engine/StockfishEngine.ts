import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";
import { Chess } from "chess.js";

import { EngineLine } from "shared/types/game/position/EngineLine";
import EngineVersion from "shared/constants/EngineVersion";
import { STARTING_FEN } from "shared/constants/utils";

const uciEvaluationTypes: Record<string, "centipawn" | "mate" | undefined> = {
    cp: "centipawn",
    mate: "mate"
};

export interface StockfishEvaluateOptions {
    depth: number;
    lines?: number;
    threads?: number;
    timeLimit?: number; // In milliseconds
    onEngineLine?: (line: EngineLine) => void;
}

export function getStockfishBinaryPath(): string {
    if (process.env.STOCKFISH_PATH && fs.existsSync(process.env.STOCKFISH_PATH)) {
        return process.env.STOCKFISH_PATH;
    }

    const candidates = [
        "/usr/local/bin/stockfish",
        "/app/bin/stockfish",
        path.join(process.cwd(), "bin", process.platform === "win32" ? "stockfish.exe" : "stockfish"),
        process.platform === "win32" ? "stockfish.exe" : "stockfish"
    ];

    for (const candidate of candidates) {
        if (candidate.includes("/") || candidate.includes("\\")) {
            if (fs.existsSync(candidate)) return candidate;
        }
    }

    return process.env.STOCKFISH_PATH || (process.platform === "win32" ? "stockfish.exe" : "/usr/local/bin/stockfish");
}

export class StockfishEngine {
    private process: ChildProcessWithoutNullStreams | null = null;
    private rl: readline.Interface | null = null;
    private position = STARTING_FEN;
    private evaluating = false;
    private isReady = false;

    private lineListeners: ((line: string) => void)[] = [];

    constructor(private binaryPath: string = getStockfishBinaryPath()) {}

    public async init(): Promise<void> {
        if (this.process) return;

        return new Promise((resolve, reject) => {
            let ready = false;
            try {
                this.process = spawn(this.binaryPath, [], {
                    stdio: ["pipe", "pipe", "pipe"]
                });
            } catch (err) {
                return reject(new Error(`Failed to spawn Stockfish binary at ${this.binaryPath}: ${(err as Error).message}`));
            }

            const engineProcess = this.process;
            engineProcess.on("error", err => {
                if (!ready) reject(new Error(`Stockfish process error: ${err.message}`));
            });
            engineProcess.once("close", () => {
                if (ready) return;
                this.removeLineListener(onUciOk);
                reject(new Error("Stockfish exited before completing UCI initialization."));
            });

            this.rl = readline.createInterface({
                input: engineProcess.stdout,
                crlfDelay: Infinity
            });

            this.rl.on("line", line => {
                for (const listener of [...this.lineListeners]) {
                    listener(line);
                }
            });

            const onUciOk = (line: string) => {
                if (line === "uciok") {
                    this.sendCommand("isready");
                } else if (line === "readyok") {
                    ready = true;
                    this.removeLineListener(onUciOk);
                    this.isReady = true;
                    resolve();
                }
            };

            this.addLineListener(onUciOk);
            this.sendCommand("uci");
        });
    }

    private addLineListener(listener: (line: string) => void) {
        this.lineListeners.push(listener);
    }

    private removeLineListener(listener: (line: string) => void) {
        this.lineListeners = this.lineListeners.filter(l => l !== listener);
    }

    public sendCommand(command: string) {
        if (this.process && this.process.stdin.writable) {
            this.process.stdin.write(`${command}\n`);
        }
    }

    public setPosition(fen: string, moves?: string[], currentFen?: string): this {
        this.position = currentFen || fen;

        if (moves && moves.length > 0) {
            this.sendCommand(`position fen ${fen} moves ${moves.join(" ")}`);
            if (!currentFen) {
                const board = new Chess(fen);
                for (const move of moves) {
                    try {
                        board.move(move);
                    } catch {
                        break;
                    }
                }
                this.position = board.fen();
            }
        } else {
            this.sendCommand(`position fen ${fen}`);
        }

        return this;
    }

    public setOption(name: string, value: string | number): this {
        this.sendCommand(`setoption name ${name} value ${value}`);
        return this;
    }

    public setLineCount(lines: number): this {
        return this.setOption("MultiPV", lines);
    }

    public setThreadCount(threads: number): this {
        return this.setOption("Threads", threads);
    }

    public setHashSize(hash: number): this {
        return this.setOption("Hash", hash);
    }

    public async evaluate(options: StockfishEvaluateOptions): Promise<EngineLine[]> {
        if (!this.process) {
            await this.init();
        }
        const engineProcess = this.process;
        if (!engineProcess) throw new Error("Stockfish process is not running.");

        const linesMap = new Map<number, EngineLine>();
        this.evaluating = true;

        if (options.lines) {
            this.setLineCount(options.lines);
        }

        if (options.threads) {
            this.setThreadCount(options.threads);
        }

        const currentPosition = this.position;
        const timeLimitArg = options.timeLimit ? ` movetime ${options.timeLimit}` : "";
        const tempBoard = new Chess(currentPosition); // Instantiate once per evaluation

        return new Promise((resolve, reject) => {
            let settled = false;
            const onLine = (log: string) => {
                if (log.startsWith("bestmove") || log.includes("depth 0")) {
                    settled = true;
                    this.removeLineListener(onLine);
                    engineProcess.removeListener("close", onProcessClose);
                    this.evaluating = false;
                    const result = Array.from(linesMap.values()).sort((a, b) => a.index - b.index);

                    // Convert the final lines to SAN before resolving
                    for (const line of result) {
                        let movesMade = 0;
                        try {
                            for (const move of line.moves) {
                                // If SAN was already computed (e.g., if onEngineLine was present), skip
                                if (move.san && move.san !== move.uci) {
                                    const m = tempBoard.move(move.uci);
                                    if (m) movesMade++;
                                    continue;
                                }

                                const m = tempBoard.move(move.uci);
                                if (!m) break;
                                move.san = m.san;
                                movesMade++;
                            }
                        } catch {
                        } finally {
                            for (let i = 0; i < movesMade; i++) {
                                tempBoard.undo();
                            }
                        }
                    }

                    resolve(result);
                    return;
                }

                if (!log.startsWith("info depth") || log.includes("currmove")) {
                    return;
                }

                const depth = parseInt(log.match(/(?<= depth )\d+/)?.[0] || "");
                if (isNaN(depth)) return;

                const index = parseInt(log.match(/(?<= multipv )\d+/)?.[0] || "") || 1;

                const scoreMatches = log.match(/ score (cp|mate) (-?\d+)/);
                if (!scoreMatches) return;

                const rawType = scoreMatches[1];
                const evaluationType = uciEvaluationTypes[rawType];
                if (!evaluationType) return;

                let evaluationScore = parseInt(scoreMatches[2]);
                if (isNaN(evaluationScore)) return;

                // Ensure score is always from White's perspective
                if (currentPosition.includes(" b ")) {
                    evaluationScore = -evaluationScore;
                }

                const moveUcis = log.match(/ pv (.*)/)?.[1]?.trim().split(/\s+/) || [];
                const moveSans: string[] = [];

                // We do NOT parse SAN for intermediate lines because it severely degrades performance.
                // SAN is only computed at the end when bestmove is reached.

                const engineLine: EngineLine = {
                    depth,
                    index,
                    evaluation: {
                        type: evaluationType,
                        value: evaluationScore
                    },
                    source: EngineVersion.STOCKFISH_19,
                    moves: moveUcis.map((uci, i) => ({
                        uci,
                        san: moveSans[i] || uci // placeholder if not translated
                    }))
                };

                linesMap.set(index, engineLine);
                options.onEngineLine?.(engineLine);
            };

            const onProcessClose = () => {
                if (settled) return;
                settled = true;
                this.removeLineListener(onLine);
                this.evaluating = false;
                reject(new Error("Stockfish exited before completing evaluation."));
            };

            this.addLineListener(onLine);
            engineProcess.once("close", onProcessClose);
            this.sendCommand(`go depth ${options.depth}${timeLimitArg}`);
        });
    }

    public async stop(): Promise<void> {
        if (!this.evaluating) return;

        return new Promise(resolve => {
            const onLine = (log: string) => {
                if (log.startsWith("bestmove")) {
                    this.removeLineListener(onLine);
                    this.evaluating = false;
                    resolve();
                }
            };

            this.addLineListener(onLine);
            this.sendCommand("stop");

            // Safety timeout
            setTimeout(() => {
                this.removeLineListener(onLine);
                this.evaluating = false;
                resolve();
            }, 1000);
        });
    }

    public terminate(): void {
        this.evaluating = false;
        try {
            this.sendCommand("quit");
        } catch {
            // ignore
        }

        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }

        if (this.process) {
            this.process.kill();
            this.process = null;
        }

        this.lineListeners = [];
    }
}

export default StockfishEngine;
