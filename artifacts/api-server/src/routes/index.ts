import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dbCheckRouter from "./db-check";
import customersRouter from "./customers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dbCheckRouter);
router.use(customersRouter);

export default router;
