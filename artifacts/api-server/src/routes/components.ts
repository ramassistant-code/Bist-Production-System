import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  componentsTable,
  insertComponentSchema,
  updateComponentSchema,
} from "@workspace/db/schema";
import { isNull, asc, and, ilike, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function hebrewValidationError(issues: Array<{ path: Array<string | number>; message: string }>): string {
  if (!issues.length) return "שגיאת אימות";
  return issues[0].message;
}

// GET /components
router.get("/components", async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, category, is_active } = req.query as Record<string, string>;

    const conditions: ReturnType<typeof isNull>[] = [isNull(componentsTable.deleted_at)];
    if (search) conditions.push(ilike(componentsTable.name, `%${search}%`) as unknown as ReturnType<typeof isNull>);
    if (category) conditions.push(eq(componentsTable.category, category) as unknown as ReturnType<typeof isNull>);
    if (is_active !== undefined) {
      conditions.push(eq(componentsTable.is_active, is_active === "true") as unknown as ReturnType<typeof isNull>);
    }

    const components = await db
      .select()
      .from(componentsTable)
      .where(and(...conditions))
      .orderBy(asc(componentsTable.name));

    res.json(components);
  } catch (err) {
    logger.error({ err }, "Failed to list components");
    res.status(500).json({ error: "שגיאה בטעינת רשימת הרכיבים" });
  }
});

// POST /components
router.post("/components", async (req: Request, res: Response): Promise<void> => {
  const parsed = insertComponentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .insert(componentsTable)
      .values(parsed.data as unknown as typeof componentsTable.$inferInsert)
      .returning();
    res.status(201).json(rows[0] ?? null);
  } catch (err) {
    logger.error({ err }, "Failed to create component");
    res.status(500).json({ error: "שגיאה ביצירת הרכיב" });
  }
});

// GET /components/:id
router.get("/components/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(componentsTable)
      .where(sql`${componentsTable.id} = ${req.params.id} AND ${componentsTable.deleted_at} IS NULL`);
    const component = rows[0];
    if (!component) {
      res.status(404).json({ error: "רכיב לא נמצא" });
      return;
    }
    res.json(component);
  } catch (err) {
    logger.error({ err }, "Failed to get component");
    res.status(500).json({ error: "שגיאה בטעינת הרכיב" });
  }
});

// PATCH /components/:id
router.patch("/components/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = updateComponentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .update(componentsTable)
      .set({ ...(parsed.data as Partial<typeof componentsTable.$inferInsert>), updated_at: new Date() })
      .where(sql`${componentsTable.id} = ${req.params.id} AND ${componentsTable.deleted_at} IS NULL`)
      .returning();
    const component = rows[0];
    if (!component) {
      res.status(404).json({ error: "רכיב לא נמצא" });
      return;
    }
    res.json(component);
  } catch (err) {
    logger.error({ err }, "Failed to update component");
    res.status(500).json({ error: "שגיאה בעדכון הרכיב" });
  }
});

export default router;
