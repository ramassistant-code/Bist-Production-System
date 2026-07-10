import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dbCheckRouter from "./db-check";
import customersRouter from "./customers";
import productsRouter from "./products";
import componentsRouter from "./components";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dbCheckRouter);
router.use(customersRouter);
router.use(productsRouter);
router.use(componentsRouter);

export default router;
