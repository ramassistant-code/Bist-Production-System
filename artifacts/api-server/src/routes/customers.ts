import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { customersTable, insertCustomerSchema, updateCustomerSchema } from "@workspace/db/schema";
import type { Customer } from "@workspace/db/schema";
import { isNull, asc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifySync } from "../lib/notifySync";

async function generateCustomerNumber(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(
      CAST(REGEXP_REPLACE(customer_number, '[^0-9]', '', 'g') AS BIGINT)
    ), 0) + 1 AS n
    FROM customers
    WHERE deleted_at IS NULL
      AND customer_number ~ '^C-[0-9]+'
  `);
  const n = (result.rows[0] as Record<string, unknown>)?.["n"] ?? 1;
  return `C-${String(n).padStart(6, "0")}`;
}

const router: IRouter = Router();

// GET /customers — list all active customers
router.get("/customers", async (_req: Request, res: Response): Promise<void> => {
  try {
    const customers = await db
      .select()
      .from(customersTable)
      .where(isNull(customersTable.deleted_at))
      .orderBy(asc(customersTable.name));
    res.json(customers);
  } catch (err) {
    logger.error({ err }, "Failed to list customers");
    res.status(500).json({ error: "שגיאה בטעינת רשימת הלקוחות" });
  }
});

// POST /customers — create a customer
const FIELD_LABELS: Record<string, string> = {
  name: "שם הלקוח הוא שדה חובה",
  email: "כתובת אימייל אינה תקינה",
  invoice_email: "כתובת אימייל לחשבוניות אינה תקינה",
};

function hebrewValidationError(issues: Array<{ path: Array<string | number>; message: string }>): string {
  if (!issues.length) return "שגיאת אימות";
  const issue = issues[0];
  const field = String(issue.path[0] ?? "");
  return FIELD_LABELS[field] ?? issue.message;
}

router.post("/customers", async (req: Request, res: Response): Promise<void> => {
  // Inject a generated customer_number if not provided
  const body = { ...req.body } as Record<string, unknown>;
  if (!body["customer_number"]) {
    try {
      body["customer_number"] = await generateCustomerNumber();
    } catch (err) {
      logger.error({ err }, "Failed to generate customer number");
      res.status(500).json({ error: "שגיאה ביצירת מספר לקוח" });
      return;
    }
  }
  const parsed = insertCustomerSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    // Drizzle insert expects the table's infer type; cast through unknown to avoid schema type drift
    const rows = await db
      .insert(customersTable)
      .values(parsed.data as unknown as typeof customersTable.$inferInsert)
      .returning();
    const created = rows[0] ?? null;
    if (created) notifySync("customer", created.id);
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to create customer");
    res.status(500).json({ error: "שגיאה ביצירת הלקוח" });
  }
});

// GET /customers/:id — get one customer
router.get("/customers/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(customersTable)
      .where(
        sql`${customersTable.id} = ${req.params.id} AND ${customersTable.deleted_at} IS NULL`,
      );
    const customer = rows[0] as Customer | undefined;
    if (!customer) {
      res.status(404).json({ error: "לקוח לא נמצא" });
      return;
    }
    res.json(customer);
  } catch (err) {
    logger.error({ err }, "Failed to get customer");
    res.status(500).json({ error: "שגיאה בטעינת הלקוח" });
  }
});

// PATCH /customers/:id — update a customer
router.patch("/customers/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .update(customersTable)
      .set({ ...(parsed.data as Partial<typeof customersTable.$inferInsert>), updated_at: new Date() })
      .where(
        sql`${customersTable.id} = ${req.params.id} AND ${customersTable.deleted_at} IS NULL`,
      )
      .returning();
    const customer = rows[0] as Customer | undefined;
    if (!customer) {
      res.status(404).json({ error: "לקוח לא נמצא" });
      return;
    }
    notifySync("customer", customer.id);
    res.json(customer);
  } catch (err) {
    logger.error({ err }, "Failed to update customer");
    res.status(500).json({ error: "שגיאה בעדכון הלקוח" });
  }
});

export default router;
