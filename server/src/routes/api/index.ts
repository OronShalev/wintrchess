import { Router } from "express";

import publicApiRouter from "./public";
import analyseRouter from "./analysis/analyse";
import evaluateRouter from "./analysis/evaluate";

const router = Router();

router.use("/api",
    publicApiRouter,
    analyseRouter,
    evaluateRouter
);

export default router;