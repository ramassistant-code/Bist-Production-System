import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmLeadNotesTable,
  crmLeadTasksTable,
  crmLeadsTable,
  insertCrmLeadNoteSchema,
  insertCrmLeadTaskSchema,
  updateCrmLeadNoteSchema,
} from "@workspace/db/schema";
import { crmLeadView, leadScope } from "../../services/crm/scope";

const router: IRouter = Router();
const NOTE_EDIT_WINDOW_MS = 15 * 60 * 1000;

function pathId(req: Request): string | null {
  const value = req.params["id"];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsedDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function scopedLead(req: Request, id: string) {
  const [lead] = await db
    .select({
      id: crmLeadsTable.id,
      sales_rep_id: crmLeadsTable.sales_rep_id,
    })
    .from(crmLeadsTable)
    .where(
      and(
        eq(crmLeadsTable.id, id),
        isNull(crmLeadsTable.deleted_at),
        leadScope(req, crmLeadView(req.query["view"])),
      ),
    )
    .limit(1);
  return lead ?? null;
}

router.post("/leads/:id/notes", async (req: Request, res: Response): Promise<void> => {
  const id = pathId(req);
  const body = bodyRecord(req.body);
  const content = typeof body?.["content"] === "string" ? body["content"].trim() : "";
  const parsed = insertCrmLeadNoteSchema.safeParse({ content });

  if (!id || !parsed.success || !content) {
    res.status(400).json({ error: "חובה להזין תוכן להערה" });
    return;
  }

  try {
    if (!(await scopedLead(req, id))) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }

    const [created] = await db
      .insert(crmLeadNotesTable)
      .values({
        lead_id: id,
        user_id: req.appUser!.id,
        content,
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create CRM lead note");
    res.status(500).json({ error: "שגיאה ביצירת ההערה" });
  }
});

router.patch("/notes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = pathId(req);
  const body = bodyRecord(req.body);
  const content = typeof body?.["content"] === "string" ? body["content"].trim() : "";
  const parsed = updateCrmLeadNoteSchema.safeParse({ content });

  if (!id || !parsed.success || !content) {
    res.status(400).json({ error: "חובה להזין תוכן להערה" });
    return;
  }

  try {
    const [note] = await db
      .select({
        id: crmLeadNotesTable.id,
        user_id: crmLeadNotesTable.user_id,
        created_at: crmLeadNotesTable.created_at,
      })
      .from(crmLeadNotesTable)
      .innerJoin(crmLeadsTable, eq(crmLeadNotesTable.lead_id, crmLeadsTable.id))
      .where(
        and(
          eq(crmLeadNotesTable.id, id),
          isNull(crmLeadsTable.deleted_at),
          leadScope(req, crmLeadView(req.query["view"])),
        ),
      )
      .limit(1);

    if (!note) {
      res.status(404).json({ error: "הערה לא נמצאה" });
      return;
    }

    const editDeadline = note.created_at.getTime() + NOTE_EDIT_WINDOW_MS;
    if (note.user_id !== req.appUser!.id || Date.now() >= editDeadline) {
      res.status(403).json({ error: "לא ניתן לערוך הערה לאחר 15 דקות" });
      return;
    }

    const [updated] = await db
      .update(crmLeadNotesTable)
      .set({ content, edited_at: new Date() })
      .where(eq(crmLeadNotesTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update CRM lead note");
    res.status(500).json({ error: "שגיאה בעדכון ההערה" });
  }
});

router.post("/leads/:id/tasks", async (req: Request, res: Response): Promise<void> => {
  const id = pathId(req);
  const body = bodyRecord(req.body);
  const title = typeof body?.["title"] === "string" ? body["title"].trim() : "";
  const description =
    typeof body?.["description"] === "string" ? body["description"].trim() || null : undefined;
  const dueAt = parsedDate(body?.["due_at"]);
  const parsed = insertCrmLeadTaskSchema.safeParse({
    title,
    description,
    due_at: dueAt,
  });

  if (!id || !title || !dueAt || !parsed.success) {
    res.status(400).json({ error: "חובה ליצור משימה עם תאריך" });
    return;
  }
  if (dueAt.getTime() <= Date.now()) {
    res.status(400).json({ error: "לא ניתן להזין תאריך שעבר" });
    return;
  }

  try {
    const lead = await scopedLead(req, id);
    if (!lead) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }

    const [created] = await db
      .insert(crmLeadTasksTable)
      .values({
        lead_id: id,
        // ראו ההערה ב-status-machine.ts: משימה בלי משויך נעלמת מ-tasks/mine.
        assigned_user_id: lead.sales_rep_id ?? req.appUser!.id,
        title,
        ...(description !== undefined ? { description } : {}),
        due_at: dueAt,
        source: "manual",
      })
      .returning();

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create CRM lead task");
    res.status(500).json({ error: "שגיאה ביצירת המשימה" });
  }
});

router.get("/tasks/mine", async (req: Request, res: Response): Promise<void> => {
  const now = new Date();
  try {
    const tasks = await db
      .select({
        id: crmLeadTasksTable.id,
        lead_id: crmLeadTasksTable.lead_id,
        assigned_user_id: crmLeadTasksTable.assigned_user_id,
        title: crmLeadTasksTable.title,
        description: crmLeadTasksTable.description,
        due_at: crmLeadTasksTable.due_at,
        status: crmLeadTasksTable.status,
        source: crmLeadTasksTable.source,
        completed_at: crmLeadTasksTable.completed_at,
        snoozed_until: crmLeadTasksTable.snoozed_until,
        whatsapp_sent_at: crmLeadTasksTable.whatsapp_sent_at,
        created_at: crmLeadTasksTable.created_at,
        updated_at: crmLeadTasksTable.updated_at,
        lead_name: crmLeadsTable.name,
        lead_phone: crmLeadsTable.phone_e164,
      })
      .from(crmLeadTasksTable)
      .innerJoin(crmLeadsTable, eq(crmLeadTasksTable.lead_id, crmLeadsTable.id))
      .where(
        and(
          eq(crmLeadTasksTable.assigned_user_id, req.appUser!.id),
          eq(crmLeadTasksTable.status, "open"),
          isNull(crmLeadsTable.deleted_at),
          lte(crmLeadTasksTable.due_at, now),
          or(
            isNull(crmLeadTasksTable.snoozed_until),
            lte(crmLeadTasksTable.snoozed_until, now),
          ),
        ),
      )
      .orderBy(asc(crmLeadTasksTable.due_at));

    res.json(tasks);
  } catch (err) {
    req.log.error({ err }, "Failed to list current user's CRM tasks");
    res.status(500).json({ error: "שגיאה בטעינת המשימות" });
  }
});

router.patch("/tasks/:id", async (req: Request, res: Response): Promise<void> => {
  const id = pathId(req);
  const body = bodyRecord(req.body);
  const hasStatus = Object.prototype.hasOwnProperty.call(body ?? {}, "status");
  const hasSnooze = Object.prototype.hasOwnProperty.call(body ?? {}, "snoozed_until");
  const status = body?.["status"];
  const snoozedUntil =
    body?.["snoozed_until"] === null ? null : parsedDate(body?.["snoozed_until"]);

  if (
    !id ||
    !body ||
    (!hasStatus && !hasSnooze) ||
    (hasStatus && status !== "open" && status !== "done") ||
    (hasSnooze && body["snoozed_until"] !== null && !snoozedUntil)
  ) {
    res.status(400).json({ error: "עדכון המשימה אינו תקין" });
    return;
  }

  try {
    // משימה ששויכה למשתמש היא שלו, גם אם הליד עצמו מחוץ ל-scope הנוכחי שלו.
    // בלי הענף הזה מנהל שקיבל משימה על ליד לא משויך מקבל 404 על "בוצע",
    // ומודאל התזכורת — שאי אפשר לסגור בדרך אחרת — נתקע פתוח.
    const [task] = await db
      .select({ id: crmLeadTasksTable.id })
      .from(crmLeadTasksTable)
      .innerJoin(crmLeadsTable, eq(crmLeadTasksTable.lead_id, crmLeadsTable.id))
      .where(
        and(
          eq(crmLeadTasksTable.id, id),
          isNull(crmLeadsTable.deleted_at),
          or(
            eq(crmLeadTasksTable.assigned_user_id, req.appUser!.id),
            leadScope(req, crmLeadView(req.query["view"])),
          ),
        ),
      )
      .limit(1);

    if (!task) {
      res.status(404).json({ error: "משימה לא נמצאה" });
      return;
    }

    const [updated] = await db
      .update(crmLeadTasksTable)
      .set({
        ...(hasStatus ? { status: status as "open" | "done" } : {}),
        ...(hasSnooze ? { snoozed_until: snoozedUntil } : {}),
      })
      .where(eq(crmLeadTasksTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update CRM lead task");
    res.status(500).json({ error: "שגיאה בעדכון המשימה" });
  }
});

export default router;