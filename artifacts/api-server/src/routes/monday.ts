import { Router, type IRouter, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import { db } from "@workspace/db";
import { dealsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// ── CodeWords webhook ─────────────────────────────────────────────────────────

async function triggerCodeWordsWebhook(payload: {
  run_id: string;
  deal_id: string;
  action: string;
  requested_by: string | null;
  options: Record<string, unknown>;
}): Promise<void> {
  const url = process.env["CODEWORDS_MONDAY_EXPORT_WEBHOOK_URL"];
  const secret = process.env["CODEWORDS_MONDAY_EXPORT_WEBHOOK_SECRET"];
  if (!url) throw new Error("CODEWORDS_MONDAY_EXPORT_WEBHOOK_URL לא מוגדר");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": secret ?? "",
      "X-Request-Id": payload.run_id,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CodeWords returned ${res.status}: ${text}`);
  }
}

// ── createMondayExportRun ─────────────────────────────────────────────────────

type CreateMondayExportRunInput = {
  dealId: string;
  actionType: "start" | "retry" | "resume";
  requestedBy: string | null;
  parentRunId?: string;
  dryRun?: boolean;
  forceUpdate?: boolean;
  retryFailedOnly?: boolean;
  targetIds?: string[];
  continueFromStep?: string;
};

async function createMondayExportRun(
  input: CreateMondayExportRunInput
): Promise<{ run: Record<string, unknown> }> {
  const [deal] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(eq(dealsTable.id, input.dealId))
    .limit(1);
  if (!deal) throw new Error("הרשומה לא נמצאה");

  const { data: targets, error: targetsErr } = await supabaseAdmin
    .from("monday_export_targets")
    .select("id, monday_board_id")
    .eq("is_active", true);
  if (targetsErr) throw new Error("שגיאה בטעינת יעדי Monday");
  if (!targets || targets.length === 0)
    throw new Error("לא הוגדרו יעדי Monday פעילים");

  const hasConfigureBoard = (targets as Record<string, unknown>[]).some(
    (t) => t["monday_board_id"] === "CONFIGURE_BOARD_ID"
  );
  if (hasConfigureBoard)
    throw new Error("לא ניתן להפעיל יעד עם מזהה לוח זמני");

  const { data: activeRuns } = await supabaseAdmin
    .from("monday_export_runs")
    .select("id")
    .eq("deal_id", input.dealId)
    .in("status", ["pending", "queued", "running", "waiting"])
    .limit(1);
  if (activeRuns && activeRuns.length > 0)
    throw new Error("כבר קיימת ריצה פעילה לעסקה זו");

  let runNumber = 1;
  try {
    const result = await db.execute(
      sql`SELECT public.get_next_monday_export_run_number(${input.dealId}::uuid) AS n`
    );
    runNumber = Number((result.rows[0] as Record<string, unknown>)?.["n"] ?? 1);
  } catch {
    // fallback
  }

  const executionContext = {
    dry_run: input.dryRun ?? false,
    force_update: input.forceUpdate ?? false,
    retry_failed_only: input.retryFailedOnly ?? false,
    target_ids: input.targetIds ?? [],
    continue_from_step: input.continueFromStep ?? null,
  };

  const { data: run, error: insertErr } = await supabaseAdmin
    .from("monday_export_runs")
    .insert({
      deal_id: input.dealId,
      run_number: runNumber,
      action_type: input.actionType,
      status: "pending",
      requested_by: input.requestedBy,
      request_source: "replit",
      parent_run_id: input.parentRunId ?? null,
      execution_context: executionContext,
    })
    .select()
    .single();

  if (insertErr || !run) throw new Error("שגיאה ביצירת רשומת ריצה");

  try {
    await triggerCodeWordsWebhook({
      run_id: (run as Record<string, string>).id,
      deal_id: input.dealId,
      action: input.actionType,
      requested_by: input.requestedBy,
      options: {
        parent_run_id: input.parentRunId ?? null,
        target_ids: input.targetIds ?? [],
        continue_from_step: input.continueFromStep ?? null,
        retry_failed_only: input.retryFailedOnly ?? false,
        force_update: input.forceUpdate ?? false,
        dry_run: input.dryRun ?? false,
      },
    });

    await supabaseAdmin
      .from("monday_export_runs")
      .update({ status: "queued" })
      .eq("id", (run as Record<string, string>).id);

    return { run: { ...(run as object), status: "queued" } };
  } catch (webhookErr) {
    const msg = (webhookErr as Error).message ?? "שגיאה";
    await supabaseAdmin
      .from("monday_export_runs")
      .update({
        status: "failed",
        error_code: "WEBHOOK_FAILED",
        error_message: "הפעלת תהליך CodeWords נכשלה",
      })
      .eq("id", (run as Record<string, string>).id);

    await supabaseAdmin.from("monday_export_run_logs").insert({
      run_id: (run as Record<string, string>).id,
      level: "error",
      event_type: "webhook_failed",
      message: "הפעלת תהליך CodeWords נכשלה",
      details: { error: msg },
    });

    throw new Error("הפעלת תהליך CodeWords נכשלה");
  }
}

// ── TARGETS ───────────────────────────────────────────────────────────────────

router.get("/monday/targets", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("monday_export_targets")
      .select("*")
      .order("sync_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ targets: data });
  } catch (err) {
    logger.error({ err }, "Failed to list Monday targets");
    res.status(500).json({ error: "שגיאה בטעינת יעדי Monday" });
  }
});

router.post("/monday/targets", async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from("monday_export_targets")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ target: data });
  } catch (err: unknown) {
    const msg = String((err as Record<string, unknown>)?.message ?? "");
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "מפתח יעד כבר קיים במערכת" });
      return;
    }
    logger.error({ err }, "Failed to create Monday target");
    res.status(500).json({ error: "שגיאה ביצירת יעד" });
  }
});

router.patch("/monday/targets/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_targets")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json({ target: data });
  } catch (err) {
    logger.error({ err }, "Failed to update Monday target");
    res.status(500).json({ error: "שגיאה בעדכון יעד" });
  }
});

router.delete("/monday/targets/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const [a, b, c, d] = await Promise.all([
      supabaseAdmin.from("monday_export_runs").select("id").eq("target_id", id).limit(1),
      supabaseAdmin.from("monday_export_run_steps").select("id").eq("target_id", id).limit(1),
      supabaseAdmin.from("monday_export_run_items").select("id").eq("target_id", id).limit(1),
      supabaseAdmin.from("monday_entity_links").select("id").eq("target_id", id).limit(1),
    ]);
    if ([a, b, c, d].some((r) => r.data && r.data.length > 0)) {
      res.status(409).json({ error: "לא ניתן למחוק יעד שיש אליו הפניות. ניתן להשבית אותו." });
      return;
    }
    const { error } = await supabaseAdmin.from("monday_export_targets").delete().eq("id", id);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete Monday target");
    res.status(500).json({ error: "שגיאה במחיקת יעד" });
  }
});

router.post("/monday/targets/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data: orig, error: fetchErr } = await supabaseAdmin
      .from("monday_export_targets")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchErr || !orig) { res.status(404).json({ error: "יעד לא נמצא" }); return; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = orig as Record<string, unknown>;
    const { data, error } = await supabaseAdmin
      .from("monday_export_targets")
      .insert({ ...rest, target_key: `${String(rest["target_key"])}_copy`, target_name: `${String(rest["target_name"])} (עותק)`, is_active: false })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ target: data });
  } catch (err) {
    logger.error({ err }, "Failed to duplicate Monday target");
    res.status(500).json({ error: "שגיאה בשכפול יעד" });
  }
});

router.post("/monday/targets/:id/activate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data: tRaw, error: tErr } = await supabaseAdmin.from("monday_export_targets").select("*").eq("id", id).single();
    if (tErr || !tRaw) { res.status(404).json({ error: "יעד לא נמצא" }); return; }
    const t = tRaw as Record<string, unknown>;
    const blockers: string[] = [];

    if (!t["monday_board_id"] || t["monday_board_id"] === "CONFIGURE_BOARD_ID")
      blockers.push("מזהה לוח Monday לא הוגדר (יש להחליף את CONFIGURE_BOARD_ID)");
    if (!t["board_name_expected"])
      blockers.push("שם לוח צפוי לא הוגדר");
    if (t["allow_inbound_create"] && t["inbound_create_policy"] === "reject")
      blockers.push("יצירת רשומות מ-Monday הופעלה אך מדיניות היצירה מוגדרת לחסימה");
    const protectedTypes = ["deal", "payment"];
    if (t["allow_inbound_delete"] && protectedTypes.includes(String(t["entity_type"] ?? "")))
      blockers.push(`מחיקה נכנסת מ-Monday אסורה עבור ישות מסוג '${String(t["entity_type"])}'`);

    // Check mappings
    const { data: mappings } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .select("id, sync_direction, is_active")
      .eq("target_id", id)
      .eq("is_active", true);
    const active = (mappings ?? []) as Array<{ id: string; sync_direction?: string; is_active?: boolean }>;

    if (active.length === 0)
      blockers.push("לא הוגדרו מיפויי שדות פעילים ליעד זה");
    if (t["inbound_enabled"]) {
      const hasInbound = active.some(m => ["monday_to_supabase", "bidirectional"].includes(m.sync_direction ?? "supabase_to_monday"));
      if (!hasInbound) blockers.push("סנכרון נכנס מ-Monday הופעל אך אין מיפויים נכנסים (monday_to_supabase / bidirectional)");
    }
    if (t["outbound_enabled"]) {
      const hasOutbound = active.some(m => ["supabase_to_monday", "bidirectional"].includes(m.sync_direction ?? "supabase_to_monday"));
      if (!hasOutbound) blockers.push("סנכרון יוצא ל-Monday הופעל אך אין מיפויים יוצאים (supabase_to_monday / bidirectional)");
    }

    if (blockers.length > 0) {
      res.status(400).json({ error: "לא ניתן להפעיל יעד זה — נמצאו חסמי הגדרה", blockers });
      return;
    }

    const { data, error } = await supabaseAdmin.from("monday_export_targets").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    res.json({ target: data });
  } catch (err) {
    logger.error({ err }, "Failed to activate Monday target");
    res.status(500).json({ error: "שגיאה בהפעלת יעד" });
  }
});

router.post("/monday/targets/:id/deactivate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin.from("monday_export_targets").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    res.json({ target: data });
  } catch (err) {
    logger.error({ err }, "Failed to deactivate Monday target");
    res.status(500).json({ error: "שגיאה בהשבתת יעד" });
  }
});

// ── HEALTH OVERVIEW ───────────────────────────────────────────────────────────

router.get("/monday/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data: health, error } = await supabaseAdmin
      .from("monday_sync_health_overview")
      .select("*")
      .order("target_key", { ascending: true });
    if (error) throw error;
    const rows = (health ?? []) as Array<Record<string, unknown>>;
    const summary = {
      active_targets: rows.filter((r) => r["is_active"]).length,
      polling_active: rows.filter((r) => r["inbound_enabled"]).length,
      pending_events: rows.reduce((s, r) => s + (Number(r["pending_events"]) || 0), 0),
      failed_events: rows.reduce((s, r) => s + (Number(r["failed_events"]) || 0), 0),
      open_conflicts: rows.reduce((s, r) => s + (Number(r["open_conflicts"]) || 0), 0),
    };
    res.json({ health: rows, summary });
  } catch (err) {
    logger.error({ err }, "Failed to get Monday health overview");
    res.status(500).json({ error: "שגיאה בטעינת נתוני ניטור" });
  }
});

// ── FIELD MAPPINGS ────────────────────────────────────────────────────────────

router.get("/monday/targets/:targetId/mappings", async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetId } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .select("*")
      .eq("target_id", targetId)
      .order("sync_order", { ascending: true });
    if (error) throw error;
    res.json({ mappings: data });
  } catch (err) {
    logger.error({ err }, "Failed to list Monday mappings");
    res.status(500).json({ error: "שגיאה בטעינת מיפויים" });
  }
});

router.post("/monday/targets/:targetId/mappings", async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetId } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .insert({ ...req.body, target_id: targetId })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ mapping: data });
  } catch (err: unknown) {
    const msg = String((err as Record<string, unknown>)?.message ?? "");
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "כבר קיים מיפוי פעיל לעמודת Monday זו" });
      return;
    }
    logger.error({ err }, "Failed to create Monday mapping");
    res.status(500).json({ error: "שגיאה ביצירת מיפוי" });
  }
});

router.patch("/monday/targets/:targetId/mappings/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetId, id } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("target_id", targetId)
      .select()
      .single();
    if (error) throw error;
    res.json({ mapping: data });
  } catch (err) {
    logger.error({ err }, "Failed to update Monday mapping");
    res.status(500).json({ error: "שגיאה בעדכון מיפוי" });
  }
});

router.delete("/monday/targets/:targetId/mappings/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetId, id } = req.params;
    const { error } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .delete()
      .eq("id", id)
      .eq("target_id", targetId);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete Monday mapping");
    res.status(500).json({ error: "שגיאה במחיקת מיפוי" });
  }
});

router.post("/monday/targets/:targetId/mappings/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetId, id } = req.params;
    const { data: orig, error: fetchErr } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .select("*")
      .eq("id", id)
      .eq("target_id", targetId)
      .single();
    if (fetchErr || !orig) { res.status(404).json({ error: "מיפוי לא נמצא" }); return; }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = orig as Record<string, unknown>;
    const { data, error } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .insert({ ...rest, monday_column_name: `${String(rest["monday_column_name"])} (עותק)`, is_active: false })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ mapping: data });
  } catch (err) {
    logger.error({ err }, "Failed to duplicate Monday mapping");
    res.status(500).json({ error: "שגיאה בשכפול מיפוי" });
  }
});

// ── RUNS ──────────────────────────────────────────────────────────────────────

router.get("/monday/runs", async (req: Request, res: Response): Promise<void> => {
  try {
    const { deal_id, status, action_type, errors_only, page = "1", limit = "25" } =
      req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, parseInt(limit) || 25);
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from("monday_export_runs_overview")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (deal_id) query = query.eq("deal_id", deal_id);
    if (status) query = query.eq("status", status);
    if (action_type) query = query.eq("action_type", action_type);
    if (errors_only === "true") query = query.in("status", ["failed", "completed_with_warnings"]);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ runs: data, total: count ?? 0, page: pageNum, limit: limitNum });
  } catch (err) {
    logger.error({ err }, "Failed to list Monday runs");
    res.status(500).json({ error: "שגיאה בטעינת ריצות" });
  }
});

router.post("/monday/runs", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = await getUserId(req);
    const { dealId, actionType = "start", parentRunId, dryRun, forceUpdate, retryFailedOnly, targetIds, continueFromStep } = req.body as Record<string, unknown>;
    if (!dealId) { res.status(400).json({ error: "מזהה עסקה נדרש" }); return; }
    const result = await createMondayExportRun({
      dealId: String(dealId),
      actionType: (actionType as "start" | "retry" | "resume") || "start",
      requestedBy: userId,
      parentRunId: parentRunId ? String(parentRunId) : undefined,
      dryRun: Boolean(dryRun),
      forceUpdate: Boolean(forceUpdate),
      retryFailedOnly: Boolean(retryFailedOnly),
      targetIds: Array.isArray(targetIds) ? (targetIds as string[]) : undefined,
      continueFromStep: continueFromStep ? String(continueFromStep) : undefined,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/monday/runs/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_runs_overview")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) { res.status(404).json({ error: "ריצה לא נמצאה" }); return; }
    res.json({ run: data });
  } catch (err) {
    logger.error({ err }, "Failed to get Monday run");
    res.status(500).json({ error: "שגיאה בטעינת ריצה" });
  }
});

router.post("/monday/runs/:id/retry", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = await getUserId(req);
    const { id } = req.params;
    const { data: run, error } = await supabaseAdmin.from("monday_export_runs").select("deal_id").eq("id", id).single();
    if (error || !run) { res.status(404).json({ error: "ריצה לא נמצאה" }); return; }
    const result = await createMondayExportRun({
      dealId: String((run as Record<string, unknown>)["deal_id"]),
      actionType: "retry",
      requestedBy: userId,
      parentRunId: String(id),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/monday/runs/:id/resume", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = await getUserId(req);
    const { id } = req.params;
    const { data: run, error } = await supabaseAdmin.from("monday_export_runs").select("deal_id").eq("id", id).single();
    if (error || !run) { res.status(404).json({ error: "ריצה לא נמצאה" }); return; }
    const result = await createMondayExportRun({
      dealId: String((run as Record<string, unknown>)["deal_id"]),
      actionType: "resume",
      requestedBy: userId,
      parentRunId: String(id),
      retryFailedOnly: true,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/monday/runs/:id/cancel", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data: run } = await supabaseAdmin.from("monday_export_runs").select("status").eq("id", id).single();
    const status = String((run as Record<string, unknown>)?.["status"] ?? "");
    if (!["pending", "queued"].includes(status)) {
      res.status(400).json({ error: "ניתן לבטל ריצה רק בסטטוס ממתין או בתור" });
      return;
    }
    const { data, error } = await supabaseAdmin.from("monday_export_runs").update({ status: "cancelled" }).eq("id", id).select().single();
    if (error) throw error;
    res.json({ run: data });
  } catch (err) {
    logger.error({ err }, "Failed to cancel Monday run");
    res.status(500).json({ error: "שגיאה בביטול ריצה" });
  }
});

router.get("/monday/runs/:id/steps", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from("monday_export_run_steps")
      .select("*")
      .eq("run_id", id)
      .order("step_order", { ascending: true });
    if (error) throw error;
    res.json({ steps: data });
  } catch (err) {
    logger.error({ err }, "Failed to get run steps");
    res.status(500).json({ error: "שגיאה בטעינת שלבים" });
  }
});

router.get("/monday/runs/:id/items", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { step_id, target_id, status, failed_only } = req.query as Record<string, string>;

    let query = supabaseAdmin.from("monday_export_run_items").select("*").eq("run_id", id);
    if (step_id) query = query.eq("step_id", step_id);
    if (target_id) query = query.eq("target_id", target_id);
    if (status) query = query.eq("status", status);
    if (failed_only === "true") query = query.eq("status", "failed");
    query = query.order("created_at", { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    res.json({ items: data });
  } catch (err) {
    logger.error({ err }, "Failed to get run items");
    res.status(500).json({ error: "שגיאה בטעינת רשומות" });
  }
});

router.get("/monday/runs/:id/logs", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { level, event_type, search } = req.query as Record<string, string>;

    let query = supabaseAdmin.from("monday_export_run_logs").select("*").eq("run_id", id);
    if (level) query = query.eq("level", level);
    if (event_type) query = query.eq("event_type", event_type);
    if (search) query = query.ilike("message", `%${search}%`);
    query = query.order("created_at", { ascending: true }).limit(500);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ logs: data });
  } catch (err) {
    logger.error({ err }, "Failed to get run logs");
    res.status(500).json({ error: "שגיאה בטעינת לוגים" });
  }
});

// ── DEAL RUNS ─────────────────────────────────────────────────────────────────

router.get("/monday/deals/:dealId/runs", async (req: Request, res: Response): Promise<void> => {
  try {
    const { dealId } = req.params;
    const [runsRes, linksRes] = await Promise.all([
      supabaseAdmin
        .from("monday_export_runs_overview")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin.from("monday_entity_links").select("id").eq("deal_id", dealId),
    ]);
    if (runsRes.error) throw runsRes.error;
    res.json({ runs: runsRes.data ?? [], linked_count: linksRes.data?.length ?? 0 });
  } catch (err) {
    logger.error({ err }, "Failed to get deal Monday runs");
    res.status(500).json({ error: "שגיאה בטעינת ריצות עסקה" });
  }
});

// ── VALIDATE ──────────────────────────────────────────────────────────────────

router.get("/monday/validate", async (_req: Request, res: Response): Promise<void> => {
  type ValidationResult = {
    level: "ok" | "warning" | "error";
    target?: string;
    mapping?: string;
    message: string;
    suggestion?: string;
  };
  try {
    const { data: targets } = await supabaseAdmin
      .from("monday_export_targets")
      .select("*")
      .eq("is_active", true);
    const { data: allMappings } = await supabaseAdmin
      .from("monday_export_field_mappings")
      .select("*")
      .eq("is_active", true);

    const results: ValidationResult[] = [];

    if (!targets || targets.length === 0) {
      results.push({ level: "error", message: "לא הוגדרו יעדי Monday פעילים", suggestion: "הוסף לפחות יעד פעיל אחד" });
    } else {
      const keys = (targets as Record<string, unknown>[]).map((t) => t["target_key"]);
      const dupeKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dupeKeys.length > 0) {
        results.push({ level: "error", message: `מפתחות יעד כפולים: ${dupeKeys.join(", ")}`, suggestion: "הגדר מפתח ייחודי לכל יעד" });
      }

      for (const t of targets as Record<string, unknown>[]) {
        const tName = String(t["target_name"] ?? "");
        if (t["monday_board_id"] === "CONFIGURE_BOARD_ID") {
          results.push({ level: "error", target: tName, message: "יעד מכיל מזהה לוח זמני", suggestion: "הגדר מזהה לוח אמיתי" });
        }
        if (!t["create_enabled"] && !t["update_enabled"]) {
          results.push({ level: "error", target: tName, message: "יצירה ועדכון מושבתים", suggestion: "הפעל לפחות אחד מהם" });
        }
        const targetMappings = (allMappings ?? []).filter(
          (m: Record<string, unknown>) => m["target_id"] === t["id"]
        );
        if (targetMappings.length === 0) {
          results.push({ level: "error", target: tName, message: "אין מיפויי שדות פעילים", suggestion: "הוסף מיפויים ביעד זה" });
        } else {
          // Check duplicate column mappings
          const colIds = (targetMappings as Record<string, unknown>[]).map((m) => m["monday_column_id"]);
          const dupes = colIds.filter((c, i) => colIds.indexOf(c) !== i);
          if (dupes.length > 0) {
            results.push({ level: "error", target: tName, message: "עמודות Monday כפולות במיפוי", suggestion: "הסר מיפויים כפולים" });
          } else {
            results.push({ level: "ok", target: tName, message: `${targetMappings.length} מיפויים פעילים תקינים` });
          }
        }
      }
    }

    res.json({ results });
  } catch (err) {
    logger.error({ err }, "Failed to validate Monday config");
    res.status(500).json({ error: "שגיאה בבדיקת הגדרות" });
  }
});

export default router;
