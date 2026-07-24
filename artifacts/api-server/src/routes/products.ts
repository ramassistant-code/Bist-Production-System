import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  productsTable,
  componentsTable,
  productComponentsTable,
  insertProductSchema,
  updateProductSchema,
} from "@workspace/db/schema";
import { isNull, asc, eq, sql, ilike, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function hebrewValidationError(issues: Array<{ path: Array<string | number>; message: string }>): string {
  if (!issues.length) return "שגיאת אימות";
  return issues[0].message;
}

// GET /products
router.get("/products", async (req: Request, res: Response): Promise<void> => {
  try {
    const { search, category, is_active } = req.query as Record<string, string>;

    const conditions: ReturnType<typeof isNull>[] = [isNull(productsTable.deleted_at)];
    if (search) conditions.push(ilike(productsTable.name, `%${search}%`) as unknown as ReturnType<typeof isNull>);
    if (category) conditions.push(eq(productsTable.category, category) as unknown as ReturnType<typeof isNull>);
    if (is_active !== undefined) {
      conditions.push(eq(productsTable.is_active, is_active === "true") as unknown as ReturnType<typeof isNull>);
    }

    const products = await db
      .select()
      .from(productsTable)
      .where(and(...conditions))
      .orderBy(asc(productsTable.name));

    res.json(products);
  } catch (err) {
    logger.error({ err }, "Failed to list products");
    res.status(500).json({ error: "שגיאה בטעינת רשימת המוצרים" });
  }
});

// POST /products
router.post("/products", async (req: Request, res: Response): Promise<void> => {
  const parsed = insertProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .insert(productsTable)
      .values(parsed.data as unknown as typeof productsTable.$inferInsert)
      .returning();
    res.status(201).json(rows[0] ?? null);
  } catch (err) {
    logger.error({ err }, "Failed to create product");
    res.status(500).json({ error: "שגיאה ביצירת המוצר" });
  }
});

// GET /products/:id (with components)
router.get("/products/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const productRows = await db
      .select()
      .from(productsTable)
      .where(sql`${productsTable.id} = ${req.params.id} AND ${productsTable.deleted_at} IS NULL`);

    const product = productRows[0];
    if (!product) {
      res.status(404).json({ error: "מוצר לא נמצא" });
      return;
    }

    // Fetch components with component details joined
    const componentRows = await db
      .select({
        id: productComponentsTable.id,
        product_id: productComponentsTable.product_id,
        component_id: productComponentsTable.component_id,
        default_quantity: productComponentsTable.default_quantity,
        default_unit_price: productComponentsTable.default_unit_price,
        total_cost: productComponentsTable.total_cost,
        sort_order: productComponentsTable.sort_order,
        created_at: productComponentsTable.created_at,
        updated_at: productComponentsTable.updated_at,
        component_name: componentsTable.name,
        component_number: componentsTable.component_number,
        component_deliverable: componentsTable.deliverable,
        component_internal_notes: componentsTable.internal_notes,
        component_quote_notes_default: componentsTable.quote_notes_default,
      })
      .from(productComponentsTable)
      .leftJoin(componentsTable, eq(productComponentsTable.component_id, componentsTable.id))
      .where(
        and(
          eq(productComponentsTable.product_id, String(req.params.id)),
          isNull(productComponentsTable.deleted_at),
        )
      )
      .orderBy(asc(productComponentsTable.sort_order), asc(productComponentsTable.created_at));

    // Calculate total cost from components
    const calculated_cost = componentRows
      .reduce((sum, c) => sum + parseFloat(c.total_cost ?? "0"), 0)
      .toFixed(2);

    res.json({
      ...product,
      components: componentRows,
      calculated_cost,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get product");
    res.status(500).json({ error: "שגיאה בטעינת המוצר" });
  }
});

// PATCH /products/:id
router.patch("/products/:id", async (req: Request, res: Response): Promise<void> => {
  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: hebrewValidationError(parsed.error.issues as Array<{ path: Array<string | number>; message: string }>) });
    return;
  }
  try {
    const rows = await db
      .update(productsTable)
      .set({ ...(parsed.data as Partial<typeof productsTable.$inferInsert>), updated_at: new Date() })
      .where(sql`${productsTable.id} = ${req.params.id} AND ${productsTable.deleted_at} IS NULL`)
      .returning();
    const product = rows[0];
    if (!product) {
      res.status(404).json({ error: "מוצר לא נמצא" });
      return;
    }
    res.json(product);
  } catch (err) {
    logger.error({ err }, "Failed to update product");
    res.status(500).json({ error: "שגיאה בעדכון המוצר" });
  }
});

// POST /products/:id/components — add component to product
router.post("/products/:id/components", async (req: Request, res: Response): Promise<void> => {
  const { component_id, default_quantity, default_unit_price } = req.body as {
    component_id?: string;
    default_quantity?: string;
    default_unit_price?: string;
  };

  if (!component_id) {
    res.status(400).json({ error: "יש לבחור רכיב" });
    return;
  }

  try {
    // Fetch component cost for snapshot
    const compRows = await db
      .select({ cost: componentsTable.cost })
      .from(componentsTable)
      .where(eq(componentsTable.id, component_id));

    const comp = compRows[0];
    if (!comp) {
      res.status(400).json({ error: "הרכיב לא נמצא" });
      return;
    }

    const qty = parseFloat(default_quantity ?? "1") || 1;
    const unitPrice = default_unit_price !== undefined
      ? parseFloat(default_unit_price)
      : parseFloat(comp.cost ?? "0");
    const total = (qty * unitPrice).toFixed(2);

    const rows = await db
      .insert(productComponentsTable)
      .values({
        product_id: req.params.id,
        component_id,
        default_quantity: String(qty),
        default_unit_price: String(unitPrice),
        total_cost: total,
      } as unknown as typeof productComponentsTable.$inferInsert)
      .returning();

    const inserted = rows[0];

    // Return with component name joined
    const fullRows = await db
      .select({
        id: productComponentsTable.id,
        product_id: productComponentsTable.product_id,
        component_id: productComponentsTable.component_id,
        default_quantity: productComponentsTable.default_quantity,
        default_unit_price: productComponentsTable.default_unit_price,
        total_cost: productComponentsTable.total_cost,
        sort_order: productComponentsTable.sort_order,
        created_at: productComponentsTable.created_at,
        updated_at: productComponentsTable.updated_at,
        component_name: componentsTable.name,
        component_number: componentsTable.component_number,
        component_deliverable: componentsTable.deliverable,
      })
      .from(productComponentsTable)
      .leftJoin(componentsTable, eq(productComponentsTable.component_id, componentsTable.id))
      .where(eq(productComponentsTable.id, inserted!.id));

    res.status(201).json(fullRows[0] ?? inserted);
  } catch (err) {
    logger.error({ err }, "Failed to add product component");
    res.status(500).json({ error: "שגיאה בהוספת הרכיב למוצר" });
  }
});

// PATCH /products/:id/components/:pc_id
router.patch("/products/:id/components/:pc_id", async (req: Request, res: Response): Promise<void> => {
  const { default_quantity, default_unit_price } = req.body as {
    default_quantity?: string;
    default_unit_price?: string;
  };

  try {
    const existing = await db
      .select()
      .from(productComponentsTable)
      .where(
        and(
          eq(productComponentsTable.id, String(req.params.pc_id)),
          eq(productComponentsTable.product_id, String(req.params.id)),
          isNull(productComponentsTable.deleted_at),
        )
      );

    if (!existing[0]) {
      res.status(404).json({ error: "שורת רכיב לא נמצאה" });
      return;
    }

    const qty = default_quantity !== undefined
      ? parseFloat(default_quantity)
      : parseFloat(existing[0].default_quantity ?? "1");
    const price = default_unit_price !== undefined
      ? parseFloat(default_unit_price)
      : parseFloat(existing[0].default_unit_price ?? "0");
    const total = (qty * price).toFixed(2);

    const rows = await db
      .update(productComponentsTable)
      .set({
        default_quantity: String(qty),
        default_unit_price: String(price),
        total_cost: total,
        updated_at: new Date(),
      } as Partial<typeof productComponentsTable.$inferInsert>)
      .where(eq(productComponentsTable.id, String(req.params.pc_id)))
      .returning();

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, "Failed to update product component");
    res.status(500).json({ error: "שגיאה בעדכון הרכיב" });
  }
});

// DELETE /products/:id/components/:pc_id
router.delete("/products/:id/components/:pc_id", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .update(productComponentsTable)
      .set({ deleted_at: new Date() } as Partial<typeof productComponentsTable.$inferInsert>)
      .where(
        and(
          eq(productComponentsTable.id, String(req.params.pc_id)),
          eq(productComponentsTable.product_id, String(req.params.id)),
          isNull(productComponentsTable.deleted_at),
        )
      )
      .returning();

    if (!rows[0]) {
      res.status(404).json({ error: "שורת רכיב לא נמצאה" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "Failed to remove product component");
    res.status(500).json({ error: "שגיאה בהסרת הרכיב" });
  }
});

export default router;
