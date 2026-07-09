import { Router, type IRouter } from "express";
import { DbCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/db-check", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    const data = DbCheckResponse.parse({
      status: "ok",
      database: "connected",
    });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "Database connectivity check failed");
    res.status(500).json({ error: "database connection failed" });
  }
});

export default router;
