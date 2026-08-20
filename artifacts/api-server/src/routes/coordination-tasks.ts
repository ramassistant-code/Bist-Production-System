import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /coordination-tasks ───────────────────────────────────────────────────
// Returns the coordination tasks with enough deal/customer context for the table
// and the task details dialog.
router.get("/coordination-tasks", async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT
        t.id,
        t.deal_id,
        t.task_text,
        t.assignee_role,
        t.status,
        t.created_at,
        t.updated_at,
        t.completed_at,
        t.cancelled_at,
        d.deal_number,
        d.execution_status,
        d.customer_id,
        c.name AS customer_name,
        c.phone AS customer_phone
      FROM deal_coordination_tasks t
      LEFT JOIN deals d ON d.id = t.deal_id
      LEFT JOIN customers c ON c.id = d.customer_id
      ORDER BY t.created_at DESC, t.id DESC
    `);

    res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "coordination tasks list failed");
    res.status(500).json({ error: "שגיאה בטעינת המשימות" });
  }
});

export default router;