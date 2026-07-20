import { Router, type IRouter, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const ALLOWED_TABLES = new Set([
  "lookup_customer_type",
  "lookup_industry",
  "lookup_contact_status",
]);

const router: IRouter = Router();

router.get("/lookups/:table", async (req: Request, res: Response): Promise<void> => {
  const table = req.params["table"] ?? "";
  if (!ALLOWED_TABLES.has(table)) {
    res.status(400).json({ error: "לוח בדיקה לא ידוע" });
    return;
  }
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("value, label")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    logger.error({ err }, `Failed to load lookup table: ${table}`);
    res.status(500).json({ error: "שגיאה בטעינת נתוני בדיקה" });
  }
});

export default router;
