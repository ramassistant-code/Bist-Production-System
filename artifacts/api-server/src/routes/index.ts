import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dbCheckRouter from "./db-check";
import statsRouter from "./stats";
import customersRouter from "./customers";
import leadsRouter from "./leads";
import productsRouter from "./products";
import componentsRouter from "./components";
import quotesRouter from "./quotes";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dbCheckRouter);
router.use(statsRouter);
router.use(customersRouter);
router.use(leadsRouter);
router.use(productsRouter);
router.use(componentsRouter);
router.use(quotesRouter);
router.use(usersRouter);

export default router;
