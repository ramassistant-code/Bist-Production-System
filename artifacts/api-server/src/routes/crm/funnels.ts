import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmFunnelCostHistoryTable,
  crmFunnelsTable,
} from "@workspace/db/schema";
import { requireRole } from "../../middlewares/require-auth";

const router: IRouter = Router();

router.use("/funnels", requireRole("admin"));

function bodyAsRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : typeof value === "string" ? value : undefined;
}

router.get("/funnels", async (req: Request, res: Response): Promise<void> => {
  try {
    const funnels = await db
      .select()
      .from(crmFunnelsTable)
      .orderBy(asc(crmFunnelsTable.name));
    res.json(funnels);
  } catch (err) {
    req.log.error({ err }, "Failed to list CRM funnels");
    res.status(500).json({ error: "שגיאה בטעינת המשפכים" });
  }
});

router.post("/funnels", async (req: Request, res: Response): Promise<void> => {
  const body = bodyAsRecord(req.body);
  const name = typeof body?.["name"] === "string" ? body["name"].trim() : "";
  const currentCost = stringOrNull(body?.["current_cost_per_lead"]);
  const isActive = body?.["is_active"];

  if (!name || currentCost === undefined || (isActive !== undefined && typeof isActive !== "boolean")) {
    res.status(400).json({ error: "פרטי המשפך אינם תקינים" });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('crm.actor_id', ${req.appUser!.id}, true)`);
      const [funnel] = await tx
        .insert(crmFunnelsTable)
        .values({
          name,
          current_cost_per_lead: currentCost,
          ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
        })
        .returning();
      return funnel;
    });

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create CRM funnel");
    res.status(500).json({ error: "שגיאה ביצירת המשפך" });
  }
});

router.patch("/funnels", async (req: Request, res: Response): Promise<void> => {
  const body = bodyAsRecord(req.body);
  const id = typeof body?.["id"] === "string" ? body["id"] : "";
  const name = body?.["name"];
  const currentCost = stringOrNull(body?.["current_cost_per_lead"]);
  const isActive = body?.["is_active"];

  if (
    !id ||
    (name !== undefined && (typeof name !== "string" || !name.trim())) ||
    currentCost === undefined && isActive === undefined && name === undefined ||
    (isActive !== undefined && typeof isActive !== "boolean")
  ) {
    res.status(400).json({ error: "עדכון המשפך אינו תקין" });
    return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('crm.actor_id', ${req.appUser!.id}, true)`);
      const [funnel] = await tx
        .update(crmFunnelsTable)
        .set({
          ...(typeof name === "string" ? { name: name.trim() } : {}),
          ...(currentCost !== undefined ? { current_cost_per_lead: currentCost } : {}),
          ...(typeof isActive === "boolean" ? { is_active: isActive } : {}),
          updated_at: new Date(),
        })
        .where(eq(crmFunnelsTable.id, id))
        .returning();
      return funnel;
    });

    if (!updated) {
      res.status(404).json({ error: "משפך לא נמצא" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update CRM funnel");
    res.status(500).json({ error: "שגיאה בעדכון המשפך" });
  }
});

router.get(
  "/funnels/:id/cost-history",
  async (req: Request, res: Response): Promise<void> => {
    const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
    if (!rawId) {
      res.status(400).json({ error: "מזהה משפך חסר" });
      return;
    }

    try {
      const history = await db
        .select()
        .from(crmFunnelCostHistoryTable)
        .where(eq(crmFunnelCostHistoryTable.funnel_id, rawId))
        .orderBy(desc(crmFunnelCostHistoryTable.valid_from), desc(crmFunnelCostHistoryTable.created_at));
      res.json(history);
    } catch (err) {
      req.log.error({ err }, "Failed to load CRM funnel cost history");
      res.status(500).json({ error: "שגיאה בטעינת היסטוריית העלויות" });
    }
  },
);

export default router;