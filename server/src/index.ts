import express from "express";
import cluster from "cluster";
import os from "os";
import dotenv from "dotenv";

import connectDatabase from "@/database/connect";
import { getGlobalPool } from "@/lib/engine/EnginePool";
import hostnameWhitelist from "@/lib/security/whitelist";
import mainRouter from "./routes";

dotenv.config();

const port = process.env.PORT || 8080;
const nodeEnv = process.env.NODE_ENV || "production";

const coreCount = Math.min(
    os.cpus().length,
    parseInt(process.env.WORKER_COUNT || "4")
);

async function main() {
    if (cluster.isPrimary) {
        console.log("starting server...");
        for (let i = 0; i < coreCount; i++) cluster.fork();

        return;
    }

    await connectDatabase();
    await getGlobalPool();

    const app = express();

    app.use(hostnameWhitelist);

    // Static assets
    app.use("/",
        express.static("client/dist"),
        express.static("client/public")
    );

    // Normal endpoints
    app.use("/", mainRouter);

    // Start listening for requests
    app.listen(port, () => {
        if (cluster.worker?.id != 1) return;

        console.log(
            `server running on port ${port} `
            + `(${nodeEnv} mode, ${coreCount} thread`
            + (coreCount > 1 ? "s)" : ")")
        );
    });
}

main();