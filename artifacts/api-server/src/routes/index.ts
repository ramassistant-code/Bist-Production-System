import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dbCheckRouter from "./db-check";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dbCheckRouter);

export default router;
