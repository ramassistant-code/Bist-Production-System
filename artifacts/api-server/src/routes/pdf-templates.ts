import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /pdf-templates/quote/active ──────────────────────────────────────────

router.get(
  "/pdf-templates/quote/active",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { data, error } = await supabaseAdmin
        .from("pdf_templates")
        .select("*")
        .eq("document_type", "quote")
        .eq("status", "active")
        .eq("is_default", true)
        .single();

      if (error || !data) {
        res.status(404).json({ error: "לא נמצא טמפלט פעיל" });
        return;
      }

      res.json({ template: data });
    } catch (err) {
      logger.error({ err }, "GET /pdf-templates/quote/active error");
      res.status(500).json({ error: "שגיאה בטעינת הטמפלט" });
    }
  },
);

// ── GET /pdf-templates/quote/history ─────────────────────────────────────────

router.get(
  "/pdf-templates/quote/history",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { data, error } = await supabaseAdmin
        .from("pdf_templates")
        .select("id, version, name, status, created_at, activated_at, created_by")
        .eq("document_type", "quote")
        .order("version", { ascending: false });

      if (error) {
        logger.error({ err: error }, "Failed to fetch pdf_templates history");
        res.status(500).json({ error: "שגיאה בטעינת ההיסטוריה" });
        return;
      }

      res.json({ history: data ?? [] });
    } catch (err) {
      logger.error({ err }, "GET /pdf-templates/quote/history error");
      res.status(500).json({ error: "שגיאה בטעינת ההיסטוריה" });
    }
  },
);

// ── POST /pdf-templates/quote/publish ────────────────────────────────────────

router.post(
  "/pdf-templates/quote/publish",
  async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    try {
      const { data: userData, error: authErr } =
        await supabaseAdmin.auth.getUser(token);

      if (authErr || !userData?.user) {
        res.status(401).json({ error: "לא מורשה" });
        return;
      }

      const userId = userData.user.id;

      interface PublishBody {
        name: string;
        configuration: Record<string, unknown>;
      }

      const body = req.body as PublishBody;
      const { name, configuration } = body;

      if (!name || typeof name !== "string" || name.trim() === "") {
        res.status(400).json({ error: "שם הטמפלט נדרש" });
        return;
      }

      if (!configuration || typeof configuration !== "object") {
        res.status(400).json({ error: "קונפיגורציה לא תקינה" });
        return;
      }

      // 1. Load current active template
      const { data: current, error: fetchErr } = await supabaseAdmin
        .from("pdf_templates")
        .select("*")
        .eq("document_type", "quote")
        .eq("status", "active")
        .eq("is_default", true)
        .single();

      if (fetchErr || !current) {
        res.status(404).json({ error: "לא נמצא טמפלט פעיל לארכוב" });
        return;
      }

      // 2. Archive current
      const { error: archiveErr } = await supabaseAdmin
        .from("pdf_templates")
        .update({ status: "archived", is_default: false })
        .eq("id", current.id);

      if (archiveErr) {
        logger.error({ err: archiveErr }, "Failed to archive current template");
        res.status(500).json({ error: "שגיאה בארכוב הגרסה הנוכחית" });
        return;
      }

      // 3. Insert new version
      const newVersion = (typeof current.version === "number" ? current.version : 1) + 1;

      const { data: newTemplate, error: insertErr } = await supabaseAdmin
        .from("pdf_templates")
        .insert({
          template_key: current.template_key as string,
          name: name.trim(),
          document_type: "quote",
          version: newVersion,
          status: "active",
          is_default: true,
          template_path: current.template_path as string,
          configuration,
          activated_at: new Date().toISOString(),
          created_by: userId,
          description: current.description as string | null,
        })
        .select()
        .single();

      if (insertErr || !newTemplate) {
        // Rollback: restore previous active
        const { error: rollbackErr } = await supabaseAdmin
          .from("pdf_templates")
          .update({ status: "active", is_default: true })
          .eq("id", current.id);

        if (rollbackErr) {
          logger.error({ err: rollbackErr }, "CRITICAL: rollback failed after failed insert");
        }

        logger.error({ err: insertErr }, "Failed to insert new template version");
        res.status(500).json({ error: "שגיאה ביצירת גרסה חדשה" });
        return;
      }

      res.json({ template: newTemplate });
    } catch (err) {
      logger.error({ err }, "POST /pdf-templates/quote/publish error");
      res.status(500).json({ error: "שגיאה בפרסום הטמפלט" });
    }
  },
);

export default router;
