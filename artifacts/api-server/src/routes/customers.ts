import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { customersTable, dealsTable, quotesTable, paymentsTable, creditsTable, insertCustomerSchema, updateCustomerSchema } from "@workspace/db/schema";
import type { Customer } from "@workspace/db/schema";
import { isNull, asc, sql, and, or, ilike, eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifySync } from "../lib/syncClient";

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

// GET /customers — list active customers with optional search
router.get("/customers", async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    const conditions = [isNull(customersTable.deleted_at)];
    if (search) {
      conditions.push(
        or(
          ilike(customersTable.name, `%${search}%`),
          ilike(customersTable.customer_number, `%${search}%`),
          ilike(customersTable.phone, `%${search}%`),
        )!
      );
    }
    const customers = await db
      .select()
      .from(customersTable)
      .where(and(...conditions))
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
    if (created) void notifySync({ action: "customer_upserted", id: created.id });
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
    void notifySync({ action: "customer_upserted", id: customer.id });
    res.json(customer);
  } catch (err) {
    logger.error({ err }, "Failed to update customer");
    res.status(500).json({ error: "שגיאה בעדכון הלקוח" });
  }
});

// DELETE /customers/:id — soft-delete with referential integrity check
router.delete("/customers/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // 1. Verify customer exists
    const existing = await db
      .select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable)
      .where(sql`${customersTable.id} = ${id} AND ${customersTable.deleted_at} IS NULL`);
    if (!existing[0]) {
      res.status(404).json({ error: "לקוח לא נמצא" });
      return;
    }

    // 2. Check for linked records
    const [linkedDeals, linkedQuotes, linkedPayments, linkedCredits] = await Promise.all([
      db.select({ id: dealsTable.id }).from(dealsTable)
        .where(sql`${dealsTable.customer_id} = ${id} AND ${dealsTable.deleted_at} IS NULL`)
        .limit(1),
      db.select({ id: quotesTable.id }).from(quotesTable)
        .where(sql`${quotesTable.customer_id} = ${id} AND ${quotesTable.deleted_at} IS NULL`)
        .limit(1),
      db.select({ id: paymentsTable.id }).from(paymentsTable)
        .where(eq(paymentsTable.customer_id, id))
        .limit(1),
      db.select({ id: creditsTable.id }).from(creditsTable)
        .where(eq(creditsTable.customer_id, id))
        .limit(1),
    ]);

    const links: string[] = [];
    if (linkedDeals.length) links.push("עסקאות");
    if (linkedQuotes.length) links.push("הצעות מחיר");
    if (linkedPayments.length) links.push("תשלומים");
    if (linkedCredits.length) links.push("קרדיטים");

    if (links.length) {
      res.status(409).json({
        error: `לא ניתן למחוק את הלקוח — קיימים רשומות מקושרות: ${links.join(", ")}`,
      });
      return;
    }

    // 3. Soft-delete
    await db
      .update(customersTable)
      .set({ deleted_at: new Date() })
      .where(sql`${customersTable.id} = ${id} AND ${customersTable.deleted_at} IS NULL`);

    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "DELETE /customers/:id error");
    res.status(500).json({ error: "שגיאה במחיקת הלקוח" });
  }
});

export default router;
