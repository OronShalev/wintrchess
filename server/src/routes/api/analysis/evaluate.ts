import express, { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";

import { getGlobalPool } from "@/lib/engine/EnginePool";

const path = "/analysis/engine/evaluate";

const router = Router();

router.use(path, express.json());

const evaluateRequestSchema = z.object({
    fen: z.string(),
    moves: z.array(z.string()).optional(),
    depth: z.number().min(1).max(99).default(16),
    lines: z.number().min(1).max(5).default(1),
    timeLimit: z.number().min(0.01).optional() // In seconds
});

router.post(path, async (req, res) => {
    const parseResult = evaluateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(StatusCodes.BAD_REQUEST).json(parseResult.error);
    }

    const { fen, moves, depth, lines, timeLimit } = parseResult.data;
    const timeLimitMs = timeLimit ? Math.round(timeLimit * 1000) : undefined;

    const isSse = req.headers.accept?.includes("text/event-stream");
    const pool = await getGlobalPool();

    let clientDisconnected = false;
    let keepAlive: NodeJS.Timeout | undefined;
    const responseSocket = res.socket;

    function markClientDisconnected() {
        if (clientDisconnected || res.writableEnded) return;
        clientDisconnected = true;
    }

    function writeSse(data: string) {
        if (clientDisconnected || res.destroyed || res.writableEnded) return false;

        try {
            res.write(data, error => {
                if (error) markClientDisconnected();
            });
            return true;
        } catch {
            markClientDisconnected();
            return false;
        }
    }

    res.on("close", () => {
        if (!res.writableEnded) markClientDisconnected();
    });
    res.on("error", markClientDisconnected);
    responseSocket?.on("error", markClientDisconnected);

    const engine = await pool.acquire();

    try {
        if (clientDisconnected) return;

        engine.setPosition(fen, moves);

        if (isSse) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();
            keepAlive = setInterval(() => writeSse(": keep-alive\n\n"), 15000);
            keepAlive.unref();

            const finalLines = await engine.evaluate({
                depth,
                lines,
                timeLimit: timeLimitMs,
                onEngineLine: line => {
                    writeSse(`data: ${JSON.stringify(line)}\n\n`);
                }
            });

            if (!clientDisconnected) {
                writeSse(`event: done\ndata: ${JSON.stringify({ lines: finalLines })}\n\n`);
                res.end();
            }
        } else {
            const finalLines = await engine.evaluate({
                depth,
                lines,
                timeLimit: timeLimitMs
            });

            res.json({ lines: finalLines });
        }
    } catch (err) {
        if (!clientDisconnected) {
            console.error("Stockfish evaluate error:", err);
            if (isSse && res.headersSent) {
                writeSse(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`);
                if (!clientDisconnected && !res.writableEnded) res.end();
            } else if (!res.headersSent) {
                res.status(StatusCodes.INTERNAL_SERVER_ERROR).send((err as Error).message);
            }
        }
    } finally {
        if (keepAlive) clearInterval(keepAlive);
        res.removeListener("error", markClientDisconnected);
        responseSocket?.removeListener("error", markClientDisconnected);
        // Return engine to pool instead of destroying it
        pool.release(engine);
    }
});

export default router;
