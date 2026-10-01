import { Router } from "express";

import appRouter from "@/lib/appRouter";

const router = Router();

router.get("/analysis", appRouter("features/analysis.html"));

router.get("/news*", appRouter("features/news.html"));

export default router;