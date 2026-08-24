import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { crmAdsTable, crmFunnelsTable } from "@workspace/db/schema";
import { requireRole } from "../../middlewares/require-auth";

const router: IRouter = Router();

router.get("/ads", async (req: Request, res: Response): Promise<void> => {
  try {
    const ads = await db.select().from(crmAdsTable).orderBy(asc(crmAdsTable.name));
    res.json(ads);
  } catch (err) {
    req.log.error({ err }, "Failed to list CRM ads");
    res.status(500).json({ error: "שגיאה בטעינת המודעות" });
  }
});

router.get("/ads/unlinked", async (req: Request, res: Response): Promise<void> => {
  try {
    const ads = await db
      .select()
      .from(crmAdsTable)
      .where(isNull(crmAdsTable.funnel_id))
      .orderBy(asc(crmAdsTable.created_at));
    res.json(ads);
  } catch (err) {
    req.log.error({ err }, "Failed to list unlinked CRM ads");
    res.status(500).json({ error: "שגיאה בטעינת המודעות הלא מקושרות" });
  }
});

router.patch(
  "/ads/:id",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
    const body = req.body as { funnel_id?: unknown } | null;
    const funnelId = body?.funnel_id;

    if (!rawId || (funnelId !== null && typeof funnelId !== "string")) {
      res.status(400).json({ error: "קישור המשפך אינו תקין" });
      return;
    }

    try {
      if (typeof funnelId === "string") {
        const [funnel] = await db
          .select({ id: crmFunnelsTable.id })
          .from(crmFunnelsTable)
          .where(eq(crmFunnelsTable.id, funnelId))
          .limit(1);
        if (!funnel) {
          res.status(400).json({ error: "המשפך שנבחר לא נמצא" });
          return;
        }
      }

      const [updated] = await db
        .update(crmAdsTable)
        .set({ funnel_id: funnelId, updated_at: new Date() })
        .where(eq(crmAdsTable.id, rawId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "מודעה לא נמצאה" });
        return;
      }

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "Failed to link CRM ad to funnel");
      res.status(500).json({ error: "שגיאה בעדכון המודעה" });
    }
  },
);

export default router;