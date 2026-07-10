import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { leadsTable, insertLeadSchema, updateLeadSchema } from "@workspace/db/schema";
import type { Lead } from "@workspace/db/schema";
import { isNull, asc, sql, and, or, ilike, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function hebrewValidationError(issues: Array<{ path: Array<string | number>; message: string }>): string {
  if (!issues.length) return "שגיאת אימות";
  const issue = issues[0];
  const field = String(issue.path[0] ?? "");
  const LABELS: Record<string, string> = {
    name: "שם הליד הוא שדה חובה",
    email: "כתובת אימייל אינה תקינה",
  };
  return LABELS[field] ?? issue.message;
}

// GET /leads — list active leads with optional server-side filtering
router.get("/leads", async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    const status = typeof req.query["status"] === "string" ? req.query["status"].trim() : "";
    const limit = Math.min(Number(req.query["limit"] ?? 300), 500);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [isNull(leadsTable.deleted_at)];
    if (search) {
      conditions.push(
        or(
          ilike(leadsTable.name, `%${search}%`),
          ilike(leadsTable.phone, `%${search}%`),
          ilike(leadsTable.email, `%${search}%`),
          ilike(leadsTable.lead_number, `%${search}%`),
        )!
      );
    }
    if (status) {
      conditions.push(eq(leadsTable.status, status));
    }

    const where = and(...conditions);

    const [leads, countResult] = await Promise.all([
      db
        .select()
        .from(leadsTable)
        .where(where)
        .orderBy(asc(leadsTable.lead_created_at))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(leadsTable)
        .where(where),
    ]);

    const total = countResult[0]?.count ?? 0;
    res.setHeader("X-Total-Count", String(total));
    res.json(leads);
  } catch (err) {
    logger.error({ err }, "Failed to list leads");
    res.status(500).json({ error: "שגיאה בטעינת רשימת הלידים" });
  }
});

// POST /leads — create a lead
router.post("/leads", async (req: Request, res: Response): Promise<void> => {
  const parsed = insertLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .insert(leadsTable)
      .values(parsed.data as unknown as typeof leadsTable.$inferInsert)
      .returning();
    res.status(201).json(rows[0] ?? null);
  } catch (err) {
    logger.error({ err }, "Failed to create lead");
    res.status(500).json({ error: "שגיאה ביצירת הליד" });
  }
});

// GET /leads/:id — get one lead
router.get("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(leadsTable)
      .where(sql`${leadsTable.id} = ${req.params.id} AND ${leadsTable.deleted_at} IS NULL`);
    const lead = rows[0] as Lead | undefined;
    if (!lead) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }
    res.json(lead);
  } catch (err) {
    logger.error({ err }, "Failed to get lead");
    res.status(500).json({ error: "שגיאה בטעינת הליד" });
  }
});

// PATCH /leads/:id — update a lead
router.patch("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .update(leadsTable)
      .set({ ...(parsed.data as Partial<typeof leadsTable.$inferInsert>), updated_at: new Date() })
      .where(sql`${leadsTable.id} = ${req.params.id} AND ${leadsTable.deleted_at} IS NULL`)
      .returning();
    const lead = rows[0] as Lead | undefined;
    if (!lead) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }
    res.json(lead);
  } catch (err) {
    logger.error({ err }, "Failed to update lead");
    res.status(500).json({ error: "שגיאה בעדכון הליד" });
  }
});

export default router;
