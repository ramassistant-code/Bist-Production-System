import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  dealsTable,
  customersTable,
  quotesTable,
  quoteVersionsTable,
  leadsTable,
  dealCoordinationTasksTable,
} from "@workspace/db/schema";
import {
  isNull,
  eq,
  sql,
  and,
  ilike,
  desc,
} from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const VALID_EXECUTION_STATUSES = ["פתוחה", "ממתינה לתיאום", "בטיפול", "הושלמה", "בוטלה"];
const VALID_PAYMENT_TYPES = ["cash", "credit_card", "bank_transfer"];
const VALID_ASSIGNEE_ROLES = ["sales_manager", "office_manager"];

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
  const e = err as Record<string, string> | null;
  if (!e) return null;
  if (e.code === "23505") {
    if (e.constraint?.includes("source_quote_version_id")) {
      return "כבר קיימת עסקה עבור גרסת הצעה זו";
    }
    return "רשומה כפולה";
  }
  const msg = e.message ?? "";
  if (msg.includes("Deal can only be created from an approved quote version") ||
      msg.includes("Approved quote version must be locked")) {
    return "לא ניתן לפתוח עסקה מהצעה שלא אושרה";
  }
  if (msg.includes("Deal snapshots and source quote reference cannot be modified")) {
    return "לא ניתן לשנות נתוני עסקה לאחר יצירתה";
  }
  return null;
}

// ── GET /deals ────────────────────────────────────────────────────────────────

router.get("/deals", async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const search = String(req.query["search"] ?? "").trim();
    const executionStatus = String(req.query["execution_status"] ?? "").trim();

    const baseConditions = [isNull(dealsTable.deleted_at)];

    if (search) {
      baseConditions.push(
        sql`(
          ${dealsTable.deal_number} ILIKE ${"%" + search + "%"}
          OR ${customersTable.name} ILIKE ${"%" + search + "%"}
          OR ${quotesTable.quote_number} ILIKE ${"%" + search + "%"}
        )` as ReturnType<typeof isNull>
      );
    }

    if (executionStatus) {
      baseConditions.push(eq(dealsTable.execution_status, executionStatus) as ReturnType<typeof isNull>);
    }

    const baseQuery = db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        customer_name: customersTable.name,
        total_amount: dealsTable.total_amount,
        total_amount_including_vat: dealsTable.total_amount_including_vat,
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
        salesperson_user_id: dealsTable.salesperson_user_id,
        payment_status: dealsTable.payment_status,
        execution_status: dealsTable.execution_status,
        purchase_date: dealsTable.purchase_date,
        next_payment_date: dealsTable.next_payment_date,
        total_amount: dealsTable.total_amount,
        total_amount_including_vat: dealsTable.total_amount_including_vat,
        paid_amount: dealsTable.paid_amount,
        amount_paid_including_vat: dealsTable.amount_paid_including_vat,
        remaining_amount: dealsTable.remaining_amount,
        payment_type: dealsTable.payment_type,
        installments_count: dealsTable.installments_count,
        invoice_name: dealsTable.invoice_name,
        invoice_id_number: dealsTable.invoice_id_number,
        invoice_email: dealsTable.invoice_email,
        coordination_tasks_requested: dealsTable.coordination_tasks_requested,
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

    // Load coordination tasks if applicable
    const coordTasks = deal.coordination_tasks_requested
      ? await db
          .select()
          .from(dealCoordinationTasksTable)
          .where(eq(dealCoordinationTasksTable.deal_id, id))
          .orderBy(dealCoordinationTasksTable.created_at)
      : [];

    res.json({ ...deal, version_number, coordination_tasks: coordTasks });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id error");
    res.status(500).json({ error: "שגיאה בטעינת העסקה" });
  }
});

// ── POST /deals ───────────────────────────────────────────────────────────────

interface CoordinationTaskInput {
  task_text: string;
  assignee_role: string;
}

interface OpenDealBody {
  source_quote_version_id: string;
  salesperson_user_id: string;
  amount_paid_including_vat: string | number;
  payment_type: string;
  installments_count?: string | number | null;
  invoice_name?: string;
  invoice_id_number?: string;
  invoice_email?: string;
  coordination_tasks_requested?: boolean;
  coordination_tasks?: CoordinationTaskInput[];
  operation_notes?: string;
  // Lead editable fields
  lead_name?: string;
  lead_phone?: string;
  lead_email?: string;
  lead_tax_id?: string;
}

router.post("/deals", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as OpenDealBody;
  const {
    source_quote_version_id,
    salesperson_user_id,
    payment_type,
    coordination_tasks_requested = false,
    coordination_tasks = [],
    operation_notes,
    lead_name,
    lead_phone,
    lead_email,
    lead_tax_id,
  } = body;

  const amount_paid_including_vat = Number(body.amount_paid_including_vat ?? 0);
  const installments_count = body.installments_count ? Number(body.installments_count) : null;
  const invoice_name = body.invoice_name?.trim() ?? null;
  const invoice_id_number = body.invoice_id_number?.trim() ?? null;
  const invoice_email = body.invoice_email?.trim() ?? null;

  // ── Server-side validation ─────────────────────────────────────────────────
  if (!source_quote_version_id) {
    res.status(400).json({ error: "חובה לציין גרסת הצעת מחיר" });
    return;
  }
  if (!salesperson_user_id) {
    res.status(400).json({ error: "יש לבחור איש מכירות" });
    return;
  }
  if (isNaN(amount_paid_including_vat) || amount_paid_including_vat < 0) {
    res.status(400).json({ error: "יש להזין סכום ששולם תקין" });
    return;
  }
  if (!payment_type || !VALID_PAYMENT_TYPES.includes(payment_type)) {
    res.status(400).json({ error: "יש לבחור סוג תשלום" });
    return;
  }
  if (payment_type === "credit_card") {
    if (!installments_count || installments_count < 1 || !Number.isInteger(installments_count)) {
      res.status(400).json({ error: "באשראי יש להזין כמות תשלומים" });
      return;
    }
  } else {
    if (!invoice_name) {
      res.status(400).json({ error: "במזומן או העברה בנקאית יש להזין פרטי חשבונית" });
      return;
    }
    if (!invoice_id_number) {
      res.status(400).json({ error: "במזומן או העברה בנקאית יש להזין פרטי חשבונית" });
      return;
    }
    if (!invoice_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice_email)) {
      res.status(400).json({ error: "יש להזין מייל תקין לשליחת חשבונית" });
      return;
    }
  }
  if (coordination_tasks_requested) {
    if (!Array.isArray(coordination_tasks) || coordination_tasks.length === 0) {
      res.status(400).json({ error: "יש להזין לפחות משימת תיאום אחת" });
      return;
    }
    for (const t of coordination_tasks) {
      if (!t.task_text?.trim() || !t.assignee_role || !VALID_ASSIGNEE_ROLES.includes(t.assignee_role)) {
        res.status(400).json({ error: "יש למלא טקסט ואחראי לכל משימה" });
        return;
      }
    }
  }

  try {
    // 1. Load + validate quote version
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

    if (version.status !== "approved") {
      res.status(400).json({ error: "לא ניתן לפתוח עסקה מהצעה שלא אושרה" });
      return;
    }
    if (!version.locked_at) {
      res.status(400).json({ error: "גרסת ההצעה אינה נעולה" });
      return;
    }

    // 2. Check no existing deal
    const existingDeal = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.source_quote_version_id, source_quote_version_id)))
      .limit(1);
    if (existingDeal.length > 0) {
      res.status(409).json({ error: "כבר קיימת עסקה עבור גרסת הצעה זו" });
      return;
    }

    // 3. Load parent quote
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

    // 4. total_amount_including_vat from snapshot
    const totalsSnap = version.totals_snapshot as Record<string, number> | null;
    const total_amount_including_vat = totalsSnap?.total_with_vat ?? 0;

    if (amount_paid_including_vat > total_amount_including_vat) {
      res.status(400).json({ error: "סכום ששולם לא יכול להיות גבוה מסך העסקה" });
      return;
    }

    // 5. Resolve customer_id (with optional lead field overrides)
    let customer_id: string | null = quote.customer_id ?? null;

    if (!customer_id && quote.lead_id) {
      // Try by lead_id
      const byLead = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(isNull(customersTable.deleted_at), eq(customersTable.lead_id, quote.lead_id)))
        .limit(1);

      if (byLead.length > 0) {
        customer_id = byLead[0].id;
      } else {
        // Try phone lookup
        const snap = version.party_snapshot as Record<string, string> | null;
        const phoneForLookup = lead_phone ?? snap?.normalized_phone ?? snap?.phone ?? "";
        if (phoneForLookup) {
          const localDigits = phoneForLookup.replace(/\D/g, "").slice(-9);
          const byPhone = await db
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(and(isNull(customersTable.deleted_at), ilike(customersTable.phone, `%${localDigits}%`)))
            .limit(1);
          if (byPhone.length > 0) {
            customer_id = byPhone[0].id;
          }
        }

        // Create customer from lead data (possibly with user-edited fields)
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
                name: lead_name?.trim() || lead.name || "לקוח חדש",
                phone: lead_phone?.trim() || lead.phone || null,
                email: lead_email?.trim() || lead.email || null,
                tax_id: lead_tax_id?.trim() || null,
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

    // 6. Generate deal_number
    const deal_number = await generateDealNumber();

    // 7. INSERT deal — trigger fills quote_id and snapshots
    const inserted = await db
      .insert(dealsTable)
      .values({
        deal_number,
        customer_id,
        source_quote_version_id,
        salesperson_user_id: salesperson_user_id || null,
        execution_status: "פתוחה",
        total_amount: String(total_amount_including_vat),
        total_amount_including_vat: String(total_amount_including_vat),
        paid_amount: String(amount_paid_including_vat),
        amount_paid_including_vat: String(amount_paid_including_vat),
        payment_type,
        installments_count: payment_type === "credit_card" ? installments_count : null,
        invoice_name: payment_type !== "credit_card" ? invoice_name : null,
        invoice_id_number: payment_type !== "credit_card" ? invoice_id_number : null,
        invoice_email: payment_type !== "credit_card" ? invoice_email : null,
        coordination_tasks_requested,
        special_notes: operation_notes?.trim() || null,
        payment_status: "ממתינה לתשלום",
      })
      .returning({ id: dealsTable.id, deal_number: dealsTable.deal_number });

    const newDealId = inserted[0]?.id;
    const newDealNumber = inserted[0]?.deal_number;

    // 8. Create coordination tasks
    if (coordination_tasks_requested && coordination_tasks.length > 0 && newDealId) {
      await db.insert(dealCoordinationTasksTable).values(
        coordination_tasks.map((t) => ({
          deal_id: newDealId,
          task_text: t.task_text.trim(),
          assignee_role: t.assignee_role,
          status: "open",
        }))
      );
    }

    res.status(201).json({ id: newDealId, deal_number: newDealNumber });
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
