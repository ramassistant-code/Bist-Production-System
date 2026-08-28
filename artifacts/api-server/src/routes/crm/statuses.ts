import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmLeadStatusesTable,
  crmLeadsTable,
  crmRejectionReasonsTable,
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

router.get("/rejection-reasons", async (req: Request, res: Response): Promise<void> => {
  try {
    const reasons = await db
      .select({
        code: crmRejectionReasonsTable.code,
        label: crmRejectionReasonsTable.label,
        requires_detail: crmRejectionReasonsTable.requires_detail,
        sort_order: crmRejectionReasonsTable.sort_order,
      })
      .from(crmRejectionReasonsTable)
      .where(eq(crmRejectionReasonsTable.is_active, true))
      .orderBy(asc(crmRejectionReasonsTable.sort_order));

    res.json(reasons);
  } catch (err) {
    req.log.error({ err }, "Failed to list CRM rejection reasons");
    res.status(500).json({ error: "שגיאה בטעינת סיבות הדחייה" });
  }
});

export default router;