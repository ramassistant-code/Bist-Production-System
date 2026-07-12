import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  dealsTable,
  customersTable,
  quotesTable,
  quoteVersionsTable,
  leadsTable,
} from "@workspace/db/schema";
import {
  isNull,
  eq,
  sql,
  and,
  or,
  ilike,
  desc,
} from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const VALID_EXECUTION_STATUSES = ["פתוחה", "ממתינה לתיאום", "בטיפול", "הושלמה", "בוטלה"];

// ── helpers ──────────────────────────────────────────────────────────────────

async function generateDealNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `D-${year}-%`;
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(deal_number FROM '[0-9]+$') AS BIGINT)
    ), 0) + 1 AS n
    FROM deals
    WHERE deal_number LIKE ${prefix}
  `);
  const n = (result.rows[0] as Record<string, unknown>)?.["n"] ?? 1;
  return `D-${year}-${String(n).padStart(6, "0")}`;
}

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

function mapPostgresError(err: unknown): string | null {
  const e = err as Record<string, string>;
  if (e.code === "23505") {
    const detail = (e.detail ?? e.constraint ?? "").toLowerCase();
    if (detail.includes("source_quote_version_id")) {
      return "כבר קיימת עסקה עבור גרסת הצעה זו";
    }
  }
  const msg = e.message ?? "";
  if (
    msg.includes("Deal can only be created from an approved quote version") ||
    msg.includes("Approved quote version must be locked before creating a deal")
  ) {
    return "לא ניתן לפתוח עסקה מהצעה שלא אושרה";
  }
  if (msg.includes("Deal snapshots and source quote reference cannot be modified after creation")) {
    logger.error({ err }, "Unexpected snapshot protection trigger hit");
    return "שגיאה בעדכון נתוני העסקה — הנתונים מוגנים";
  }
  return null;
}

// ── GET /deals ────────────────────────────────────────────────────────────────

router.get("/deals", async (req: Request, res: Response): Promise<void> => {
  const page = Math.max(1, parseInt(req.query["page"] as string) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
  const executionStatusFilter =
    typeof req.query["execution_status"] === "string" ? req.query["execution_status"].trim() : "";
  const sourceVersionId =
    typeof req.query["source_quote_version_id"] === "string"
      ? req.query["source_quote_version_id"].trim()
      : "";

  try {
    const baseConditions = [isNull(dealsTable.deleted_at)];
    if (executionStatusFilter) baseConditions.push(eq(dealsTable.execution_status, executionStatusFilter));
    if (sourceVersionId) baseConditions.push(eq(dealsTable.source_quote_version_id, sourceVersionId));
    if (search) {
      baseConditions.push(
        or(
          ilike(dealsTable.deal_number, `%${search}%`),
          ilike(customersTable.name, `%${search}%`),
          ilike(quotesTable.quote_number, `%${search}%`)
        )!
      );
    }

    const baseQuery = db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        customer_name: customersTable.name,
        total_amount: dealsTable.total_amount,
        execution_status: dealsTable.execution_status,
        payment_status: dealsTable.payment_status,
        source_quote_version_id: dealsTable.source_quote_version_id,
        quote_number: quotesTable.quote_number,
        party_snapshot: dealsTable.party_snapshot,
        created_at: dealsTable.created_at,
        updated_at: dealsTable.updated_at,
      })
      .from(dealsTable)
      .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
      .leftJoin(quotesTable, eq(dealsTable.quote_id, quotesTable.id));

    const [rows, countRows] = await Promise.all([
      baseQuery
        .where(and(...baseConditions))
        .orderBy(desc(dealsTable.created_at))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealsTable)
        .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
        .leftJoin(quotesTable, eq(dealsTable.quote_id, quotesTable.id))
        .where(and(...baseConditions)),
    ]);

    const total = countRows[0]?.count ?? 0;
    res.json({
      deals: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    logger.error({ err }, "GET /deals error");
    res.status(500).json({ error: "שגיאה בטעינת העסקאות" });
  }
});

// ── GET /deals/check-version/:versionId ──────────────────────────────────────

router.get("/deals/check-version/:versionId", async (req: Request, res: Response): Promise<void> => {
  const versionId = String(req.params["versionId"]);
  try {
    const rows = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(
        and(
          isNull(dealsTable.deleted_at),
          eq(dealsTable.source_quote_version_id, versionId)
        )
      )
      .limit(1);

    if (rows.length > 0) {
      res.json({ exists: true, deal_id: rows[0].id });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    logger.error({ err }, "GET /deals/check-version error");
    res.status(500).json({ error: "שגיאה בבדיקת עסקה" });
  }
});

// ── GET /deals/:id ────────────────────────────────────────────────────────────

router.get("/deals/:id", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  try {
    const rows = await db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        quote_id: dealsTable.quote_id,
        customer_id: dealsTable.customer_id,
        lead_id: dealsTable.lead_id,
        payment_status: dealsTable.payment_status,
        execution_status: dealsTable.execution_status,
        purchase_date: dealsTable.purchase_date,
        next_payment_date: dealsTable.next_payment_date,
        total_amount: dealsTable.total_amount,
        paid_amount: dealsTable.paid_amount,
        remaining_amount: dealsTable.remaining_amount,
        quote_link: dealsTable.quote_link,
        what_is_included: dealsTable.what_is_included,
        special_notes: dealsTable.special_notes,
        studio_hours_remaining: dealsTable.studio_hours_remaining,
        editing_tasks_remaining: dealsTable.editing_tasks_remaining,
        source_quote_version_id: dealsTable.source_quote_version_id,
        party_snapshot: dealsTable.party_snapshot,
        items_snapshot: dealsTable.items_snapshot,
        totals_snapshot: dealsTable.totals_snapshot,
        terms_snapshot: dealsTable.terms_snapshot,
        notes_snapshot: dealsTable.notes_snapshot,
        snapshot_locked_at: dealsTable.snapshot_locked_at,
        created_at: dealsTable.created_at,
        updated_at: dealsTable.updated_at,
        customer_name: customersTable.name,
        customer_phone: customersTable.phone,
        quote_number: quotesTable.quote_number,
      })
      .from(dealsTable)
      .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
      .leftJoin(quotesTable, eq(dealsTable.quote_id, quotesTable.id))
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.id, id)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "עסקה לא נמצאה" });
      return;
    }

    const deal = rows[0];
    let version_number: number | null = null;
    if (deal.source_quote_version_id) {
      const vRows = await db
        .select({ version_number: quoteVersionsTable.version_number })
        .from(quoteVersionsTable)
        .where(eq(quoteVersionsTable.id, deal.source_quote_version_id))
        .limit(1);
      version_number = vRows[0]?.version_number ?? null;
    }

    res.json({ ...deal, version_number });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id error");
    res.status(500).json({ error: "שגיאה בטעינת פרטי העסקה" });
  }
});

// ── POST /deals ───────────────────────────────────────────────────────────────

router.post("/deals", async (req: Request, res: Response): Promise<void> => {
  const { source_quote_version_id } = req.body as Record<string, string>;

  if (!source_quote_version_id) {
    res.status(400).json({ error: "חובה לציין גרסת הצעת מחיר" });
    return;
  }

  try {
    // 1. Get the quote version
    const vRows = await db
      .select()
      .from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.id, source_quote_version_id))
      .limit(1);

    if (vRows.length === 0) {
      res.status(404).json({ error: "גרסת ההצעה לא נמצאה" });
      return;
    }
    const version = vRows[0];

    // 2. UI-level validation
    if (version.status !== "approved") {
      res.status(400).json({ error: "לא ניתן לפתוח עסקה מהצעה שלא אושרה" });
      return;
    }
    if (!version.locked_at) {
      res.status(400).json({ error: "לא ניתן לפתוח עסקה מהצעה שלא אושרה" });
      return;
    }

    // 3. Get the parent quote
    const qRows = await db
      .select()
      .from(quotesTable)
      .where(eq(quotesTable.id, version.quote_id))
      .limit(1);

    if (qRows.length === 0) {
      res.status(404).json({ error: "הצעת המחיר לא נמצאה" });
      return;
    }
    const quote = qRows[0];

    // 4. Resolve customer_id
    let customer_id: string | null = quote.customer_id ?? null;

    if (!customer_id && quote.lead_id) {
      // Try to find customer linked to this lead
      const byLead = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(isNull(customersTable.deleted_at), eq(customersTable.lead_id, quote.lead_id)))
        .limit(1);

      if (byLead.length > 0) {
        customer_id = byLead[0].id;
      } else {
        // Try phone lookup from party_snapshot
        const snap = version.party_snapshot as Record<string, string> | null;
        const rawPhone = snap?.normalized_phone ?? snap?.phone ?? "";
        if (rawPhone) {
          const localDigits = rawPhone.replace(/\D/g, "").slice(-9);
          const byPhone = await db
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(and(isNull(customersTable.deleted_at), ilike(customersTable.phone, `%${localDigits}%`)))
            .limit(1);
          if (byPhone.length > 0) {
            customer_id = byPhone[0].id;
          }
        }

        // Still no customer — create from lead data
        if (!customer_id) {
          const lRows = await db
            .select()
            .from(leadsTable)
            .where(eq(leadsTable.id, quote.lead_id))
            .limit(1);

          if (lRows.length > 0) {
            const lead = lRows[0];
            const custNum = await generateCustomerNumber();
            const inserted = await db
              .insert(customersTable)
              .values({
                customer_number: custNum,
                name: lead.name ?? "לקוח חדש",
                phone: lead.phone ?? null,
                email: lead.email ?? null,
                lead_id: lead.id,
              })
              .returning({ id: customersTable.id });
            customer_id = inserted[0]?.id ?? null;
          }
        }
      }
    }

    if (!customer_id) {
      res.status(400).json({ error: "לא ניתן לזהות לקוח עבור עסקה זו" });
      return;
    }

    // 5. Generate deal_number
    const deal_number = await generateDealNumber();

    // 6. total_amount from snapshot
    const totalsSnap = version.totals_snapshot as Record<string, number> | null;
    const total_amount = String(totalsSnap?.total_with_vat ?? 0);

    // 7. INSERT — trigger fills quote_id and all 5 snapshot columns
    const inserted = await db
      .insert(dealsTable)
      .values({
        deal_number,
        customer_id,
        source_quote_version_id,
        execution_status: "פתוחה",
        total_amount,
        paid_amount: "0",
      })
      .returning({ id: dealsTable.id, deal_number: dealsTable.deal_number });

    res.status(201).json({ id: inserted[0]?.id, deal_number: inserted[0]?.deal_number });
  } catch (err) {
    logger.error({ err }, "POST /deals error");
    const mapped = mapPostgresError(err);
    if (mapped) {
      const status = (err as Record<string, string>).code === "23505" ? 409 : 400;
      res.status(status).json({ error: mapped });
      return;
    }
    res.status(500).json({ error: "שגיאה פנימית ביצירת העסקה" });
  }
});

// ── PATCH /deals/:id ──────────────────────────────────────────────────────────

router.patch("/deals/:id", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  const { execution_status, payment_status, special_notes } = req.body as Record<string, string>;

  if (execution_status !== undefined && !VALID_EXECUTION_STATUSES.includes(execution_status)) {
    res.status(400).json({ error: "ערך סטטוס ביצוע אינו תקין" });
    return;
  }

  if (execution_status === "בוטלה" && !(special_notes ?? "").trim()) {
    res.status(400).json({ error: "נדרשת הערה בעת ביטול עסקה" });
    return;
  }

  try {
    const updateValues: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (execution_status !== undefined) updateValues.execution_status = execution_status;
    if (payment_status !== undefined) updateValues.payment_status = payment_status;
    if (special_notes !== undefined) updateValues.special_notes = special_notes;

    const updated = await db
      .update(dealsTable)
      .set(updateValues)
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.id, id)))
      .returning({ id: dealsTable.id });

    if (updated.length === 0) {
      res.status(404).json({ error: "עסקה לא נמצאה" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "PATCH /deals/:id error");
    const mapped = mapPostgresError(err);
    if (mapped) {
      res.status(400).json({ error: mapped });
      return;
    }
    res.status(500).json({ error: "שגיאה פנימית בעדכון העסקה" });
  }
});

export default router;
