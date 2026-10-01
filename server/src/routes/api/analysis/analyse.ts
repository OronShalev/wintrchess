import express, { Router } from "express";
import { StatusCodes } from "http-status-codes";
import {
    SerializedStateTreeNode,
    serializeNode,
    deserializeNode,
    stateTreeNodeSchema,
    getNodeChain
} from "shared/types/game/position/StateTreeNode";
import { getGameAnalysis } from "shared/lib/reporter/report";
import evaluateGameOnServer from "@/lib/engine/evaluateGame";

const path = "/analysis/analyse";

const router = Router();

router.use(path, express.json({ limit: "5mb" }));

router.post(path, async (req, res) => {
    let serializedStateTree: SerializedStateTreeNode;
    let depth: number | undefined;
    let lines: number | undefined;
    let timeLimit: number | undefined;
    let initialPosition: string | undefined;

    // Support both wrapped request body and raw SerializedStateTreeNode
    if (req.body && typeof req.body === "object" && "stateTree" in req.body) {
        serializedStateTree = req.body.stateTree;
        depth = req.body.depth;
        lines = req.body.lines;
        timeLimit = req.body.timeLimit;
        initialPosition = req.body.initialPosition;
    } else {
        serializedStateTree = req.body;
    }

    if (!stateTreeNodeSchema.safeParse(serializedStateTree).success) {
        return res.sendStatus(StatusCodes.BAD_REQUEST);
    }

    const stateTree = deserializeNode(serializedStateTree);
    const nodes = getNodeChain(stateTree);

    // Determine if nodes need server-side Stockfish evaluation
    const needsEvaluation = nodes.some(n => !n.state.engineLines || n.state.engineLines.length === 0);

    const isSse = req.headers.accept?.includes("text/event-stream");
    const abortController = new AbortController();

    let clientDisconnected = false;
    res.on("close", () => {
        if (res.writableEnded) return;
        clientDisconnected = true;
        abortController.abort();
    });

    const analysisOptions = {
        includeBrilliant: req.query.brilliant === "true",
        includeCritical: req.query.critical === "true",
        includeTheory: req.query.theory === "true"
    };

    try {
        if (isSse) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();
        }

        let gameAnalysis;
        if (needsEvaluation) {
            gameAnalysis = await evaluateGameOnServer(stateTree, {
                initialPosition,
                depth: Math.max(depth || (req.query.depth ? parseInt(req.query.depth as string) : 24), 24),
                lines: lines || (req.query.lines ? parseInt(req.query.lines as string) : 2),
                timeLimit,
                analysisOptions,
                abortSignal: abortController.signal,
                onProgress: progress => {
                    if (isSse && !clientDisconnected) {
                        res.write(`data: ${JSON.stringify({ type: "progress", progress })}\n\n`);
                    }
                }
            });
        } else {
            gameAnalysis = getGameAnalysis(stateTree, analysisOptions);
        }

        if (clientDisconnected) return;

        const serializedResult = {
            ...gameAnalysis,
            stateTree: serializeNode(gameAnalysis.stateTree)
        };

        if (isSse) {
            res.write(`data: ${JSON.stringify({ type: "complete", gameAnalysis: serializedResult })}\n\n`);
            res.end();
        } else {
            res.json(serializedResult);
        }
    } catch (err) {
        if (!clientDisconnected) {
            console.error("Analyse route error:", err);
            res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
});

export default router;