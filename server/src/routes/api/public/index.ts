import { Router } from "express";

import announcementRouter from "./announcement";
import newsArticlesRouter from "./news/articles";
import newsPagesRouter from "./news/pages";

const router = Router();

router.use("/public",
    announcementRouter,
    newsArticlesRouter,
    newsPagesRouter
);

export default router;