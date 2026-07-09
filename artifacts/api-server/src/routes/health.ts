import { Router, type IRouter } from "express";
import { HealthCheckResponse, HealthResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health", (_req, res) => {
  const data = HealthResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
