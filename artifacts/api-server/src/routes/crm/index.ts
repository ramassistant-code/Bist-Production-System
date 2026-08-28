import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/require-auth";
import funnelsRouter from "./funnels";
import adsRouter from "./ads";
import leadsRouter from "./leads";
import statusesRouter from "./statuses";
import activityRouter from "./activity";

const crmRouter: IRouter = Router();

crmRouter.use(requireAuth);
crmRouter.use(funnelsRouter);
crmRouter.use(adsRouter);
crmRouter.use(statusesRouter);
crmRouter.use(activityRouter);
crmRouter.use(leadsRouter);

export default crmRouter;