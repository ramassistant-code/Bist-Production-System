import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable } from "@workspace/db/schema";
import { isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // All aggregations in two parallel queries
    const [leadsAgg, customersAgg, statusRows, sourceRows, followupRows] = await Promise.all([
      // Lead counts
      db.execute(sql`
        SELECT
          COUNT(*)::int                                                                AS total,
          COUNT(*) FILTER (WHERE lead_created_at >= ${monthStart.toISOString()})::int AS this_month,
          COUNT(*) FILTER (WHERE followup_at IS NOT NULL AND followup_at < NOW())::int AS overdue,
          COUNT(*) FILTER (WHERE followup_at IS NOT NULL AND followup_at BETWEEN NOW() AND ${weekAhead.toISOString()})::int AS week_soon
        FROM leads
        WHERE deleted_at IS NULL
      `),

      // Customer counts
      db.execute(sql`
        SELECT
          COUNT(*)::int                                                              AS total,
          COUNT(*) FILTER (WHERE joined_at >= ${monthStart.toISOString()})::int    AS this_month
        FROM customers
        WHERE deleted_at IS NULL
      `),

      // Leads by status (top 8)
      db.execute(sql`
        SELECT COALESCE(status, 'לא מוגדר') AS status, COUNT(*)::int AS count
        FROM leads
        WHERE deleted_at IS NULL
        GROUP BY status
        ORDER BY count DESC
        LIMIT 8
      `),

      // Leads by source (top 6)
      db.execute(sql`
        SELECT COALESCE(lead_source, 'לא ידוע') AS source, COUNT(*)::int AS count
        FROM leads
        WHERE deleted_at IS NULL
        GROUP BY lead_source
        ORDER BY count DESC
        LIMIT 6
      `),

      // Upcoming followups (next 7 days + overdue), up to 10
      db.execute(sql`
        SELECT id, name, phone, followup_at, followup_note
        FROM leads
        WHERE deleted_at IS NULL
          AND followup_at IS NOT NULL
          AND followup_at <= ${weekAhead.toISOString()}
        ORDER BY followup_at ASC
        LIMIT 10
      `),
    ]);

    const la = leadsAgg.rows[0] as Record<string, number>;
    const ca = customersAgg.rows[0] as Record<string, number>;

    res.json({
      leads: {
        total: la["total"] ?? 0,
        this_month: la["this_month"] ?? 0,
        followup_overdue: la["overdue"] ?? 0,
        followup_week: la["week_soon"] ?? 0,
      },
      customers: {
        total: ca["total"] ?? 0,
        this_month: ca["this_month"] ?? 0,
      },
      by_status: statusRows.rows as Array<{ status: string; count: number }>,
      by_source: sourceRows.rows as Array<{ source: string; count: number }>,
      followup_soon: followupRows.rows as Array<{
        id: string;
        name: string;
        phone: string | null;
        followup_at: string;
        followup_note: string | null;
      }>,
    });
  } catch (err) {
    logger.error({ err }, "Failed to compute stats");
    res.status(500).json({ error: "שגיאה בטעינת נתוני הדשבורד" });
  }
});

export default router;
