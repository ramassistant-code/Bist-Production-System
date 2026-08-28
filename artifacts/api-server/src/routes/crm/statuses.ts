import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmLeadStatusesTable,
  crmLeadsTable,
} from "@workspace/db/schema";
import { crmLeadView, leadScope } from "../../services/crm/scope";

const router: IRouter = Router();

router.get("/lead-statuses", async (req: Request, res: Response): Promise<void> => {
  const view = crmLeadView(req.query["view"]);

  try {
    const statuses = await db
      .select({
        code: crmLeadStatusesTable.code,
        label: crmLeadStatusesTable.label,
        sort_order: crmLeadStatusesTable.sort_order,
        lead_count: sql<number>`count(${crmLeadsTable.id})::int`,
      })
      .from(crmLeadStatusesTable)
      .leftJoin(
        crmLeadsTable,
        and(
          eq(crmLeadsTable.status_code, crmLeadStatusesTable.code),
          isNull(crmLeadsTable.deleted_at),
          leadScope(req, view),
        ),
      )
      .where(eq(crmLeadStatusesTable.is_active, true))
      .groupBy(
        crmLeadStatusesTable.id,
        crmLeadStatusesTable.code,
        crmLeadStatusesTable.label,
        crmLeadStatusesTable.sort_order,
      )
      .orderBy(asc(crmLeadStatusesTable.sort_order));

    res.json(statuses);
  } catch (err) {
    req.log.error({ err }, "Failed to list CRM lead statuses");
    res.status(500).json({ error: "שגיאה בטעינת סטטוסי הלידים" });
  }
});

export default router;