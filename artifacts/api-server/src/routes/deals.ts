import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  dealsTable,
  customersTable,
  quotesTable,
  quoteVersionsTable,
  leadsTable,
  paymentsTable,
  creditsTable,
  dealCoordinationTasksTable,
} from "@workspace/db/schema";
import {
  isNull,
  eq,
  sql,
  and,
  desc,
} from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifySync } from "../lib/syncClient";

const router: IRouter = Router();

const VALID_EXECUTION_STATUSES = ["פתוחה", "ממתינה לתיאום", "בטיפול", "הושלמה", "בוטלה"];
const VALID_PAYMENT_TYPES = ["cash", "credit_card", "bank_transfer"];

// ── helpers ──────────────────────────────────────────────────────────────────

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function generateDealNumber(tx: DbOrTx = db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `D-${year}-%`;
  const result = await tx.execute(sql`
    SELECT COALESCE(MAX(
      CAST(SUBSTRING(deal_number FROM '[0-9]+$') AS BIGINT)
    ), 0) + 1 AS n
    FROM deals
    WHERE deal_number LIKE ${prefix}
  `);
  const n = (result.rows[0] as Record<string, unknown>)?.["n"] ?? 1;
  return `D-${year}-${String(n).padStart(6, "0")}`;
}

async function generateCustomerNumber(tx: DbOrTx = db): Promise<string> {
  // Advisory lock serialises concurrent number generation within the same transaction.
  // Two transactions reading MAX simultaneously would otherwise produce the same number.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customer_number_gen'))`);
  const result = await tx.execute(sql`
    SELECT COALESCE(MAX(
      CAST(REGEXP_REPLACE(customer_number, '[^0-9]', '', 'g') AS BIGINT)
    ), 0) + 1 AS n
    FROM customers
    WHERE customer_number ~ '^C-[0-9]+'
  `);
  const n = (result.rows[0] as Record<string, unknown>)?.["n"] ?? 1;
  return `C-${String(n).padStart(6, "0")}`;
}

/**
 * Normalize an Israeli phone number to local format (0XXXXXXXXX).
 * Strips spaces, dashes, parentheses, and converts +972 / 972 prefix to 0.
 */
function normalizeIsraeliPhone(raw: string): string {
  if (!raw) return "";
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return digits;
}

class DealError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "DealError";
  }
}

function pgErrCode(err: unknown): string | undefined {
  return (err as Record<string, string> | null)?.code;
}

function isPgUniqueViolation(err: unknown): boolean {
  return pgErrCode(err) === "23505";
}

// ── refreshDealPaymentTotals ──────────────────────────────────────────────────
// Recomputes paid_amount, amount_paid_including_vat, remaining_amount, and
// payment_status on the deal from the current set of non-deleted payments.

async function refreshDealPaymentTotals(dealId: string, tx: DbOrTx = db): Promise<void> {
  const sumResult = await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount_paid), 0)               AS paid_ex_vat,
      COALESCE(SUM(amount_paid_including_vat), 0) AS paid_inc_vat
    FROM payments
    WHERE deal_id = ${dealId}
      AND deleted_at IS NULL
  `);

  const sumRow = sumResult.rows[0] as { paid_ex_vat: string; paid_inc_vat: string };
  const paidExVat  = Math.round(Number(sumRow.paid_ex_vat ?? 0)  * 100) / 100;
  const paidIncVat = Math.round(Number(sumRow.paid_inc_vat ?? 0) * 100) / 100;

  const dealResult = await tx
    .select({ total_amount: dealsTable.total_amount })
    .from(dealsTable)
    .where(eq(dealsTable.id, dealId))
    .limit(1);

  const totalExVat  = Number(dealResult[0]?.total_amount ?? 0);
  const remaining   = Math.max(0, Math.round((totalExVat - paidExVat) * 100) / 100);

  const payStatus = paidExVat <= 0
    ? "ממתינה לתשלום"
    : totalExVat > 0 && remaining <= 0.01
      ? "שולמה במלואה"
      : "תשלום חלקי";

  // remaining_amount is a DB-generated column (total_amount - paid_amount); not set here
  await tx
    .update(dealsTable)
    .set({
      paid_amount:               String(paidExVat),
      amount_paid_including_vat: String(paidIncVat),
      payment_status:            payStatus,
      updated_at:                new Date(),
    })
    .where(eq(dealsTable.id, dealId));
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

// ── GET /deals/vat-audit ─────────────────────────────────────────────────────
// Read-only audit endpoint: lists deals that may have been mis-migrated during
// the VAT migration (total_amount = 0 AND total_amount_including_vat IS NULL),
// plus a sample comparison between deals.total_amount and their Monday-stored
// amounts (monday_raw_data) for deals that have already been synced.

router.get("/deals/vat-audit", async (_req: Request, res: Response): Promise<void> => {
  try {
    // ── 1. Edge cases: total_amount = 0 with no VAT-inclusive fallback ──────
    const edgeCaseRows = await db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        customer_name: customersTable.name,
        party_snapshot: dealsTable.party_snapshot,
        total_amount: dealsTable.total_amount,
        total_amount_including_vat: dealsTable.total_amount_including_vat,
        totals_snapshot: dealsTable.totals_snapshot,
        execution_status: dealsTable.execution_status,
        created_at: dealsTable.created_at,
      })
      .from(dealsTable)
      .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
      .where(
        and(
          isNull(dealsTable.deleted_at),
          sql`COALESCE(${dealsTable.total_amount}::numeric, 0) = 0`,
          isNull(dealsTable.total_amount_including_vat),
        )
      )
      .orderBy(desc(dealsTable.created_at));

    // ── 2. Comparison sample: deals synced to Monday ─────────────────────────
    // Shows deals with a monday_item_id so the user can spot-check
    // deals.total_amount (ex-VAT, pushed to Monday) against Monday's stored value.
    const sampleRows = await db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        customer_name: customersTable.name,
        party_snapshot: dealsTable.party_snapshot,
        total_amount: dealsTable.total_amount,
        total_amount_including_vat: dealsTable.total_amount_including_vat,
        totals_snapshot: dealsTable.totals_snapshot,
        monday_item_id: dealsTable.monday_item_id,
        monday_board_id: dealsTable.monday_board_id,
        monday_raw_data: dealsTable.monday_raw_data,
        execution_status: dealsTable.execution_status,
        created_at: dealsTable.created_at,
      })
      .from(dealsTable)
      .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
      .where(
        and(
          isNull(dealsTable.deleted_at),
          sql`${dealsTable.monday_item_id} IS NOT NULL`,
        )
      )
      .orderBy(desc(dealsTable.created_at))
      .limit(100);

    res.json({
      edge_cases: edgeCaseRows,
      edge_case_count: edgeCaseRows.length,
      sample: sampleRows,
      sample_count: sampleRows.length,
    });
  } catch (err) {
    logger.error({ err }, "GET /deals/vat-audit error");
    res.status(500).json({ error: "שגיאה בטעינת נתוני הביקורת" });
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

    res.json({ ...deal, version_number });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id error");
    res.status(500).json({ error: "שגיאה בטעינת העסקה" });
  }
});

// ── POST /deals/standalone — simple create (no quote snapshot) ───────────────

router.post("/deals/standalone", async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body as Record<string, unknown>;
    const deal_number = await generateDealNumber();

    const toStr  = (v: unknown) => (v === "" || v == null ? null : String(v));
    const toNum  = (v: unknown) => (v === "" || v == null ? null : Number(v));
    const toUuid = (v: unknown) => {
      const s = toStr(v);
      return s && /^[0-9a-f-]{36}$/i.test(s) ? s : null;
    };

    const rows = await db
      .insert(dealsTable)
      .values({
        deal_number,
        customer_id:        toUuid(b["customer_id"]),
        lead_id:            toUuid(b["lead_id"]),
        salesperson_id:     toUuid(b["salesperson_id"]),
        quote_id:           toUuid(b["quote_id"]),
        execution_status:   toStr(b["execution_status"]) ?? "פתוחה",
        payment_status:     toStr(b["payment_status"]),
        payment_type:       toStr(b["payment_type"]),
        installments_count: toNum(b["installments_count"]),
        purchase_date:      toStr(b["purchase_date"]),
        next_payment_date:  toStr(b["next_payment_date"]),
        invoice_name:       toStr(b["invoice_name"]),
        invoice_id_number:  toStr(b["invoice_id_number"]),
        invoice_email:      toStr(b["invoice_email"]),
        what_is_included:   toStr(b["what_is_included"]),
        special_notes:      toStr(b["special_notes"]),
      })
      .returning();

    const created = rows[0] ?? null;
    if (created) void notifySync({ action: "deal_created", id: created.id });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "POST /deals/standalone error");
    res.status(500).json({ error: "שגיאה ביצירת העסקה" });
  }
});

// ── POST /deals ───────────────────────────────────────────────────────────────

interface OpenDealBody {
  source_quote_version_id: string;
  salesperson_user_id?: string;
  amount_paid_including_vat?: string | number;
  payment_type: string;
  installments_count?: string | number | null;
  invoice_name?: string;
  invoice_id_number?: string;
  invoice_email?: string;
  coordination_tasks_requested?: boolean;
  coordination_tasks?: Array<{ task_text: string; assignee_role: string }>;
  operation_notes?: string;
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

  // ── Basic validation ──────────────────────────────────────────────────────
  if (!source_quote_version_id) {
    res.status(400).json({ success: false, code: "MISSING_QUOTE_VERSION", error: "חובה לציין גרסת הצעת מחיר" });
    return;
  }
  if (!salesperson_user_id) {
    res.status(400).json({ success: false, code: "MISSING_SALESPERSON", error: "יש לבחור איש מכירות" });
    return;
  }
  if (isNaN(amount_paid_including_vat) || amount_paid_including_vat < 0) {
    res.status(400).json({ success: false, code: "INVALID_AMOUNT", error: "יש להזין סכום ששולם תקין" });
    return;
  }
  if (!payment_type || !VALID_PAYMENT_TYPES.includes(payment_type)) {
    res.status(400).json({ success: false, code: "INVALID_PAYMENT_TYPE", error: "יש לבחור סוג תשלום" });
    return;
  }
  if (payment_type === "credit_card") {
    if (!installments_count || installments_count < 1 || !Number.isInteger(installments_count)) {
      res.status(400).json({ success: false, code: "INVALID_INSTALLMENTS", error: "באשראי יש להזין כמות תשלומים תקינה" });
      return;
    }
  } else {
    if (!invoice_name || !invoice_id_number) {
      res.status(400).json({ success: false, code: "MISSING_INVOICE_DETAILS", error: "במזומן או העברה בנקאית יש להזין פרטי חשבונית" });
      return;
    }
    if (!invoice_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice_email)) {
      res.status(400).json({ success: false, code: "INVALID_INVOICE_EMAIL", error: "יש להזין מייל תקין לשליחת חשבונית" });
      return;
    }
  }

  let newlyCreatedCustomerId: string | null = null;

  try {
    const result = await db.transaction(async (tx) => {

      // ── Step 1: Load + validate quote version ──────────────────────────────
      const vRows = await tx
        .select()
        .from(quoteVersionsTable)
        .where(eq(quoteVersionsTable.id, source_quote_version_id))
        .limit(1);

      if (vRows.length === 0) {
        throw new DealError("QUOTE_VERSION_NOT_FOUND", "גרסת ההצעה לא נמצאה", 404);
      }

      const version = vRows[0];
      if (version.status !== "approved" || !version.approved_at || !version.locked_at) {
        throw new DealError(
          "QUOTE_VERSION_NOT_APPROVED",
          "ניתן לפתוח עסקה רק מגרסת הצעת מחיר מאושרת ונעולה.",
          400,
        );
      }

      // ── Step 2: Idempotency – check for existing deal ──────────────────────
      const existingRows = await tx
        .select({
          id: dealsTable.id,
          deal_number: dealsTable.deal_number,
          customer_id: dealsTable.customer_id,
        })
        .from(dealsTable)
        .where(
          and(
            isNull(dealsTable.deleted_at),
            eq(dealsTable.source_quote_version_id, source_quote_version_id),
          )
        )
        .limit(1);

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        return {
          success: true,
          alreadyExists: true,
          dealId: existing.id,
          deal_number: existing.deal_number,
          customerId: existing.customer_id,
          paidAmountExVat: undefined as number | undefined,
        };
      }

      // ── Step 3: Load parent quote ───────────────────────────────────────────
      const qRows = await tx
        .select()
        .from(quotesTable)
        .where(eq(quotesTable.id, version.quote_id))
        .limit(1);

      if (qRows.length === 0) {
        throw new DealError("QUOTE_NOT_FOUND", "הצעת המחיר לא נמצאה", 404);
      }
      const quote = qRows[0];

      // ── Step 4: Resolve customer ────────────────────────────────────────────
      const snap = (version.party_snapshot ?? {}) as Record<string, unknown>;
      // party_snapshot may store the customer id in "customer_id", in "source_id"
      // when party_type === "customer", or fall back to the quote's own customer_id
      const snapCustomerId: string | null =
        (snap["customer_id"] as string | null) ??
        (snap["party_type"] === "customer" ? ((snap["source_id"] as string | null) ?? null) : null) ??
        quote.customer_id ??
        null;
      const snapLeadId = (snap["lead_id"] as string | null) ?? quote.lead_id ?? null;

      let resolvedCustomerId: string | null = null;
      let resolvedLeadId: string | null = snapLeadId;

      if (snapCustomerId) {
        // Case A: snapshot has a direct customer_id
        const custRows = await tx
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(and(isNull(customersTable.deleted_at), eq(customersTable.id, snapCustomerId)))
          .limit(1);

        if (custRows.length === 0) {
          throw new DealError("CUSTOMER_NOT_FOUND", "הלקוח לא נמצא בבסיס הנתונים", 400);
        }
        resolvedCustomerId = custRows[0].id;
        resolvedLeadId = null;

      } else if (snapLeadId) {
        // Case B: snapshot has a lead_id
        const leadRows = await tx
          .select()
          .from(leadsTable)
          .where(eq(leadsTable.id, snapLeadId))
          .limit(1);

        if (leadRows.length === 0) {
          throw new DealError("LEAD_NOT_FOUND", "הליד לא נמצא", 404);
        }
        const lead = leadRows[0];

        // B1: check leads.linked_customer_id
        if (lead.linked_customer_id) {
          const linkedRows = await tx
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(and(isNull(customersTable.deleted_at), eq(customersTable.id, lead.linked_customer_id)))
            .limit(1);
          if (linkedRows.length > 0) {
            resolvedCustomerId = linkedRows[0].id;
          }
        }

        // B2: check customers.lead_id = snapLeadId
        if (!resolvedCustomerId) {
          const byLeadRows = await tx
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(and(isNull(customersTable.deleted_at), eq(customersTable.lead_id, snapLeadId)))
            .limit(1);

          if (byLeadRows.length > 0) {
            resolvedCustomerId = byLeadRows[0].id;
            // Update leads.linked_customer_id
            await tx
              .update(leadsTable)
              .set({ linked_customer_id: resolvedCustomerId, updated_at: new Date() })
              .where(eq(leadsTable.id, snapLeadId));
          }
        }

        // B3: create customer from lead data
        if (!resolvedCustomerId) {
          const customerName =
            lead_name?.trim() ||
            (snap["name"] as string) ||
            (snap["contact_name"] as string) ||
            (snap["business_name"] as string) ||
            lead.name ||
            "לקוח חדש";
          const customerPhone =
            lead_phone?.trim() ||
            (snap["phone"] as string) ||
            lead.phone ||
            null;
          const customerEmail =
            lead_email?.trim() ||
            (snap["email"] as string) ||
            lead.email ||
            null;
          const customerTaxId = lead_tax_id?.trim() || null;

          const custNum = await generateCustomerNumber(tx);
          try {
            const inserted = await tx
              .insert(customersTable)
              .values({
                customer_number: custNum,
                name: customerName,
                phone: customerPhone,
                email: customerEmail,
                tax_id: customerTaxId,
                lead_id: snapLeadId,
                joined_at: new Date().toISOString().split("T")[0],
              })
              .returning({ id: customersTable.id });
            resolvedCustomerId = inserted[0]!.id;
          } catch (insertErr) {
            // Concurrent insert on the same lead_id unique constraint
            if (isPgUniqueViolation(insertErr)) {
              const concurrent = await tx
                .select({ id: customersTable.id })
                .from(customersTable)
                .where(and(isNull(customersTable.deleted_at), eq(customersTable.lead_id, snapLeadId)))
                .limit(1);
              if (concurrent.length > 0) {
                resolvedCustomerId = concurrent[0].id;
              } else {
                throw insertErr;
              }
            } else {
              throw insertErr;
            }
          }

          // Mark as newly created so we can sync after the transaction
          newlyCreatedCustomerId = resolvedCustomerId;

          // Link lead → customer
          await tx
            .update(leadsTable)
            .set({ linked_customer_id: resolvedCustomerId, updated_at: new Date() })
            .where(eq(leadsTable.id, snapLeadId));
        }

      } else {
        // Case C: no customer_id, no lead_id — normalize phone and search
        const rawPhone =
          (snap["phone"] as string) ||
          (snap["normalized_phone"] as string) ||
          "";
        const normalizedPhone = normalizeIsraeliPhone(rawPhone);

        if (normalizedPhone) {
          const byPhone = await tx
            .select({ id: customersTable.id })
            .from(customersTable)
            .where(
              and(
                isNull(customersTable.deleted_at),
                sql`REGEXP_REPLACE(${customersTable.phone}, '[^0-9]', '', 'g') = ${normalizedPhone}`,
              )
            )
            .limit(2);

          if (byPhone.length === 1) {
            resolvedCustomerId = byPhone[0].id;
          } else if (byPhone.length === 0) {
            // Create customer from snapshot data
            const customerName =
              (snap["business_name"] as string) ||
              (snap["contact_name"] as string) ||
              (snap["name"] as string) ||
              "לקוח חדש";
            const custNum = await generateCustomerNumber(tx);
            const inserted = await tx
              .insert(customersTable)
              .values({
                customer_number: custNum,
                name: customerName,
                phone: rawPhone || null,
                email: (snap["email"] as string) || null,
                joined_at: new Date().toISOString().split("T")[0],
              })
              .returning({ id: customersTable.id });
            resolvedCustomerId = inserted[0]!.id;
            // Mark as newly created so we can sync after the transaction
            newlyCreatedCustomerId = resolvedCustomerId;
          }
          // byPhone.length > 1: ambiguous — do not auto-merge
        }

        if (!resolvedCustomerId) {
          throw new DealError(
            "CUSTOMER_RESOLVE_FAILED",
            "לא ניתן לזהות לקוח עבור עסקה זו. יש לבדוק את פרטי הלקוח בהצעה.",
            400,
          );
        }
      }

      // ── Step 5: Amount validation + ex-VAT computation ─────────────────────
      const totalsSnap = (version.totals_snapshot ?? {}) as Record<string, number>;
      const total_amount_including_vat = totalsSnap["total_with_vat"] ?? 0;
      const vat_rate_raw = totalsSnap["vat_rate"] ?? 18;
      // vat_rate may be stored as decimal (0.18) or percent (18); normalise to decimal
      const vat_rate_decimal = vat_rate_raw > 1 ? vat_rate_raw / 100 : vat_rate_raw;
      const vat_divisor = 1 + vat_rate_decimal;

      // ex-VAT total: prefer snapshot field, fallback to division
      const total_amount_ex_vat = totalsSnap["subtotal_after_discount"] != null
        ? totalsSnap["subtotal_after_discount"]
        : Math.round((total_amount_including_vat / vat_divisor) * 100) / 100;

      // ex-VAT initial payment (user entered inclusive)
      const paid_amount_ex_vat = amount_paid_including_vat > 0
        ? Math.round((amount_paid_including_vat / vat_divisor) * 100) / 100
        : 0;

      if (amount_paid_including_vat > total_amount_including_vat) {
        throw new DealError(
          "PAYMENT_EXCEEDS_TOTAL",
          "סכום ששולם לא יכול להיות גבוה מסך העסקה",
          400,
        );
      }

      // ── Step 6: Generate deal number ────────────────────────────────────────
      const deal_number = await generateDealNumber(tx);

      // ── Step 7: INSERT deal — trigger fills snapshots ───────────────────────
      let newDeal: { id: string; deal_number: string } | undefined;
      try {
        const initialPayStatus = paid_amount_ex_vat >= total_amount_ex_vat - 0.01 && amount_paid_including_vat > 0
          ? "שולמה במלואה"
          : amount_paid_including_vat > 0
            ? "תשלום חלקי"
            : "ממתינה לתשלום";

        const inserted = await tx
          .insert(dealsTable)
          .values({
            deal_number,
            quote_id: version.quote_id,
            customer_id: resolvedCustomerId,
            lead_id: resolvedLeadId,
            salesperson_id: salesperson_user_id ?? null,
            source_quote_version_id,
            execution_status: "פתוחה",
            // ex-VAT amounts (for Monday sync)
            total_amount: String(total_amount_ex_vat),
            paid_amount: String(paid_amount_ex_vat),
            // remaining_amount is a DB-generated column (total_amount - paid_amount); not set here
            // VAT-inclusive amounts (for display / customer-facing)
            total_amount_including_vat: String(total_amount_including_vat),
            amount_paid_including_vat: String(amount_paid_including_vat),
            payment_type,
            installments_count: payment_type === "credit_card" ? installments_count : 1,
            invoice_name: payment_type !== "credit_card" ? invoice_name : null,
            invoice_id_number: payment_type !== "credit_card" ? invoice_id_number : null,
            invoice_email: payment_type !== "credit_card" ? invoice_email : null,
            coordination_tasks_requested,
            special_notes: operation_notes?.trim() || null,
            payment_status: initialPayStatus,
            purchase_date: new Date().toISOString().split("T")[0],
          })
          .returning({ id: dealsTable.id, deal_number: dealsTable.deal_number });
        newDeal = inserted[0];
      } catch (insertErr) {
        // Concurrent insert: return existing deal
        if (isPgUniqueViolation(insertErr)) {
          const concurrent = await tx
            .select({ id: dealsTable.id, deal_number: dealsTable.deal_number, customer_id: dealsTable.customer_id })
            .from(dealsTable)
            .where(
              and(
                isNull(dealsTable.deleted_at),
                eq(dealsTable.source_quote_version_id, source_quote_version_id),
              )
            )
            .limit(1);
          if (concurrent.length > 0) {
            return {
              success: true,
              alreadyExists: true,
              dealId: concurrent[0].id,
              deal_number: concurrent[0].deal_number,
              customerId: concurrent[0].customer_id,
              paidAmountExVat: undefined as number | undefined,
            };
          }
        }
        throw insertErr;
      }

      if (!newDeal) {
        throw new DealError("INSERT_FAILED", "שגיאה ביצירת העסקה", 500);
      }

      // ── Step 8: Verify snapshots were populated by DB trigger ───────────────
      const verifyRows = await tx
        .select({
          source_quote_version_id: dealsTable.source_quote_version_id,
          snapshot_locked_at: dealsTable.snapshot_locked_at,
          items_snapshot: dealsTable.items_snapshot,
          party_snapshot: dealsTable.party_snapshot,
          totals_snapshot: dealsTable.totals_snapshot,
        })
        .from(dealsTable)
        .where(eq(dealsTable.id, newDeal.id))
        .limit(1);

      const verified = verifyRows[0];
      if (
        !verified ||
        !verified.source_quote_version_id ||
        !verified.snapshot_locked_at ||
        !verified.items_snapshot ||
        !verified.party_snapshot ||
        !verified.totals_snapshot
      ) {
        throw new DealError(
          "DEAL_SNAPSHOT_CREATION_FAILED",
          "העסקה לא נוצרה עם Snapshot תקין של הצעת המחיר.",
          500,
        );
      }

      return {
        success: true,
        alreadyExists: false,
        dealId: newDeal.id,
        deal_number: newDeal.deal_number,
        customerId: resolvedCustomerId,
        // Carry paid_amount_ex_vat out of the transaction so Step 9 can use it
        paidAmountExVat: paid_amount_ex_vat,
      };
    });

    // ── Step 9: Payment creation (idempotent via source_key) ─────────────────
    // Only insert on the new-deal path where paidAmountExVat is known.
    // On the alreadyExists path (undefined), skip — the payment was already
    // created when the deal was first opened; a retry with a missing payment
    // row should go through a separate payment-recovery flow to guarantee the
    // correct ex-VAT/inclusive pair.
    if (amount_paid_including_vat > 0 && result.paidAmountExVat !== undefined) {
      const PAYMENT_METHOD_MAP: Record<string, string> = {
        cash: "מזומן",
        credit_card: "אשראי",
        bank_transfer: "העברה בנקאית",
      };
      const paymentMethod = PAYMENT_METHOD_MAP[payment_type] ?? null;
      const paymentSourceKey = `deal_creation:${result.dealId}`;
      const paidAmountExVat = result.paidAmountExVat;

      await db
        .insert(paymentsTable)
        .values({
          deal_id: result.dealId,
          customer_id: result.customerId ?? undefined,
          salesperson_id: salesperson_user_id ?? undefined,
          status: "התקבל",
          payment_date: new Date().toISOString().split("T")[0],
          payment_method: paymentMethod,
          payment_purpose: "לקוח חדש",
          amount_paid: String(paidAmountExVat),                  // ex-VAT for Monday
          amount_paid_including_vat: String(amount_paid_including_vat), // inclusive for display
          installments_count: payment_type === "credit_card" ? installments_count : null,
          invoice_name: payment_type !== "credit_card" ? invoice_name : null,
          invoice_tax_id: payment_type !== "credit_card" ? invoice_id_number : null,
          invoice_email: payment_type !== "credit_card" ? invoice_email : null,
          source_type: "deal_creation",
          source_key: paymentSourceKey,
        })
        .onConflictDoNothing();

      // Refresh deal totals from payments table (ensures amount_paid_including_vat
      // is always the correct VAT-inclusive sum, even if a snapshot trigger ran
      // between the deal INSERT and now).
      await refreshDealPaymentTotals(result.dealId);
    }

    // ── Step 9b: Persist billing info back to customer ───────────────────────
    if (
      result.customerId &&
      payment_type !== "credit_card" &&
      (invoice_name || invoice_id_number || invoice_email)
    ) {
      await db
        .update(customersTable)
        .set({
          ...(invoice_name ? { invoice_name } : {}),
          ...(invoice_id_number ? { tax_id: invoice_id_number } : {}),
          ...(invoice_email ? { invoice_email } : {}),
          updated_at: new Date(),
        })
        .where(eq(customersTable.id, result.customerId));
    }

    // ── Step 10: Credits creation (idempotent via source_key) ────────────────
    const dealRows = await db
      .select({ items_snapshot: dealsTable.items_snapshot })
      .from(dealsTable)
      .where(eq(dealsTable.id, result.dealId))
      .limit(1);

    interface SnapshotComponent {
      component_id: string;
      quantity: number;
      component_name_snapshot: string;
      component_description_snapshot?: string;
      internal_note?: string | null;
    }
    interface SnapshotItem {
      line_id: string;
      quantity: number;
      product_id?: string;
      product_name_snapshot?: string;
      components_snapshot?: SnapshotComponent[];
    }

    const items = (dealRows[0]?.items_snapshot ?? []) as SnapshotItem[];

    for (const item of items) {
      for (const comp of item.components_snapshot ?? []) {
        const totalQty = (item.quantity ?? 1) * (comp.quantity ?? 1);
        const creditSourceKey = `deal:${result.dealId}:item:${item.line_id}:component:${comp.component_id}`;

        await db
          .insert(creditsTable)
          .values({
            deal_id: result.dealId,
            customer_id: result.customerId ?? undefined,
            source_component_id: comp.component_id,
            source_quote_item_id: item.line_id,
            source_product_id: item.product_id ?? undefined,
            parent_product_name: item.product_name_snapshot ?? null,
            credit_name: comp.component_name_snapshot,
            description: comp.component_description_snapshot ?? null,
            status: "בתהליך",
            quantity: String(totalQty),
            source_key: creditSourceKey,
            salesperson_note: comp.internal_note?.trim() || null,
          })
          .onConflictDoNothing();
      }
    }

    // ── Step 11: Coordination tasks ──────────────────────────────────────────
    if (coordination_tasks_requested && coordination_tasks.length > 0 && !result.alreadyExists) {
      const validTasks = coordination_tasks.filter(t => t.task_text?.trim() && t.assignee_role?.trim());
      if (validTasks.length > 0) {
        await db.insert(dealCoordinationTasksTable).values(
          validTasks.map(t => ({
            deal_id: result.dealId,
            task_text: t.task_text.trim(),
            assignee_role: t.assignee_role.trim(),
            status: "open",
          }))
        );
      }
    }

    void notifySync({ action: "deal_created", id: result.dealId });
    if (newlyCreatedCustomerId) void notifySync({ action: "customer_upserted", id: newlyCreatedCustomerId });
    res.status(result.alreadyExists ? 200 : 201).json(result);

  } catch (err) {
    logger.error({ err }, "POST /deals error");

    if (err instanceof DealError) {
      res.status(err.httpStatus).json({ success: false, code: err.code, error: err.message });
      return;
    }

    const pgErr = err as Record<string, string> | null;
    if (pgErr?.code === "23505" && pgErr?.constraint?.includes("source_quote_version_id")) {
      res.status(409).json({ success: false, code: "DEAL_ALREADY_EXISTS", error: "כבר קיימת עסקה עבור גרסת הצעה זו" });
      return;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    const errDetail = (err as Record<string, unknown>)?.detail ?? undefined;
    res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      error: "שגיאה פנימית ביצירת העסקה",
      ...(process.env.NODE_ENV !== "production" ? { debug: errMsg, detail: errDetail } : {}),
    });
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

    void notifySync({ action: "deal_updated", id });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "PATCH /deals/:id error");
    res.status(500).json({ error: "שגיאה פנימית בעדכון העסקה" });
  }
});

// ── GET /deals/:id/payments ───────────────────────────────────────────────────

router.get("/deals/:id/payments", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  try {
    const rows = await db
      .select({
        id: paymentsTable.id,
        payment_number: paymentsTable.payment_number,
        payment_date: paymentsTable.payment_date,
        payment_method: paymentsTable.payment_method,
        payment_purpose: paymentsTable.payment_purpose,
        amount_paid: paymentsTable.amount_paid,
        amount_paid_including_vat: paymentsTable.amount_paid_including_vat,
        status: paymentsTable.status,
        installments_count: paymentsTable.installments_count,
        invoice_name: paymentsTable.invoice_name,
        invoice_email: paymentsTable.invoice_email,
        source_type: paymentsTable.source_type,
        created_at: paymentsTable.created_at,
      })
      .from(paymentsTable)
      .where(and(isNull(paymentsTable.deleted_at), eq(paymentsTable.deal_id, id)))
      .orderBy(paymentsTable.created_at);
    res.json({ payments: rows });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id/payments error");
    res.status(500).json({ error: "שגיאה בטעינת תשלומים" });
  }
});

// ── GET /deals/:id/credits ────────────────────────────────────────────────────

router.get("/deals/:id/credits", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  try {
    const rows = await db
      .select({
        id: creditsTable.id,
        credit_number: creditsTable.credit_number,
        credit_name: creditsTable.credit_name,
        parent_product_name: creditsTable.parent_product_name,
        description: creditsTable.description,
        status: creditsTable.status,
        quantity: creditsTable.quantity,
        completed_quantity: creditsTable.completed_quantity,
        remaining_quantity: creditsTable.remaining_quantity,
        credit_date: creditsTable.credit_date,
        owner_role: creditsTable.owner_role,
        salesperson_note: creditsTable.salesperson_note,
        created_at: creditsTable.created_at,
      })
      .from(creditsTable)
      .where(and(isNull(creditsTable.deleted_at), eq(creditsTable.deal_id, id)))
      .orderBy(creditsTable.created_at);
    res.json({ credits: rows });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id/credits error");
    res.status(500).json({ error: "שגיאה בטעינת קרדיטים" });
  }
});

// ── POST /deals/:id/payments ──────────────────────────────────────────────────

interface AddPaymentBody {
  amount_paid?: number | string;
  payment_type?: string;
  payment_date?: string;
  payment_purpose?: string;
  installments_count?: number | string | null;
  invoice_name?: string;
  invoice_id_number?: string;
  invoice_email?: string;
}

const VALID_PAYMENT_PURPOSES = ["גבייה", "לקוח חדש", "Upsell"];

router.post("/deals/:id/payments", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  const body = req.body as AddPaymentBody;

  const amount = Number(body.amount_paid ?? 0);
  const payment_type = body.payment_type ?? "";
  const payment_purpose = body.payment_purpose ?? "גבייה";
  const payment_date = body.payment_date ?? new Date().toISOString().split("T")[0];
  const installments_count = body.installments_count ? Number(body.installments_count) : null;
  const invoice_name = body.invoice_name?.trim() ?? null;
  const invoice_id_number = body.invoice_id_number?.trim() ?? null;
  const invoice_email = body.invoice_email?.trim() ?? null;

  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: "יש להזין סכום תקין גדול מאפס" });
    return;
  }
  if (!payment_type || !VALID_PAYMENT_TYPES.includes(payment_type)) {
    res.status(400).json({ error: "יש לבחור אמצעי תשלום" });
    return;
  }
  if (!VALID_PAYMENT_PURPOSES.includes(payment_purpose)) {
    res.status(400).json({ error: "מטרת תשלום לא תקינה" });
    return;
  }
  if (payment_type === "credit_card") {
    if (!installments_count || installments_count < 1 || !Number.isInteger(installments_count)) {
      res.status(400).json({ error: "באשראי יש להזין כמות תשלומים תקינה" });
      return;
    }
  } else {
    if (!invoice_name) {
      res.status(400).json({ error: "יש להזין שם על החשבונית" });
      return;
    }
  }

  try {
    const dealRows = await db
      .select({
        id: dealsTable.id,
        execution_status: dealsTable.execution_status,
        customer_id: dealsTable.customer_id,
        salesperson_id: dealsTable.salesperson_id,
        totals_snapshot: dealsTable.totals_snapshot,
      })
      .from(dealsTable)
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.id, id)))
      .limit(1);

    if (dealRows.length === 0) {
      res.status(404).json({ error: "עסקה לא נמצאה" });
      return;
    }

    const deal = dealRows[0];
    if (deal.execution_status === "בוטלה") {
      res.status(400).json({ error: "לא ניתן להוסיף תשלום לעסקה שבוטלה" });
      return;
    }

    // Derive ex-VAT from the amount entered (inclusive) using deal's vat_rate
    const dealTotals = (deal.totals_snapshot ?? {}) as Record<string, number>;
    const dealVatRateRaw = dealTotals["vat_rate"] ?? 18;
    // vat_rate may be stored as decimal (0.18) or percent (18); normalise to decimal
    const dealVatRateDecimal = dealVatRateRaw > 1 ? dealVatRateRaw / 100 : dealVatRateRaw;
    const dealVatDivisor = 1 + dealVatRateDecimal;
    const amount_inc_vat = amount; // user entered inclusive
    const amount_ex_vat  = Math.round((amount_inc_vat / dealVatDivisor) * 100) / 100;

    const PAYMENT_METHOD_MAP: Record<string, string> = {
      cash: "מזומן",
      credit_card: "אשראי",
      bank_transfer: "העברה בנקאית",
    };

    const inserted = await db
      .insert(paymentsTable)
      .values({
        deal_id: id,
        customer_id: deal.customer_id ?? undefined,
        salesperson_id: deal.salesperson_id ?? undefined,
        status: "התקבל",
        payment_date,
        payment_method: PAYMENT_METHOD_MAP[payment_type],
        payment_purpose,
        amount_paid: String(amount_ex_vat),               // ex-VAT for Monday sync
        amount_paid_including_vat: String(amount_inc_vat), // inclusive for display
        installments_count: payment_type === "credit_card" ? installments_count : 1,
        invoice_name: payment_type !== "credit_card" ? invoice_name : null,
        invoice_tax_id: payment_type !== "credit_card" ? invoice_id_number : null,
        invoice_email: payment_type !== "credit_card" ? invoice_email : null,
        source_type: "manual",
      })
      .returning({
        id: paymentsTable.id,
        payment_number: paymentsTable.payment_number,
        amount_paid: paymentsTable.amount_paid,
        amount_paid_including_vat: paymentsTable.amount_paid_including_vat,
        payment_method: paymentsTable.payment_method,
        status: paymentsTable.status,
      });

    // Refresh deal totals to reflect new payment
    await refreshDealPaymentTotals(id);
    void notifySync({ action: "deal_updated", id });

    res.status(201).json({ success: true, payment: inserted[0] });
  } catch (err) {
    const errMsg = String((err as Record<string, unknown>)?.message ?? "");
    const causeMsg = String(((err as Record<string, unknown>)?.cause as Record<string, unknown>)?.message ?? "");
    if (errMsg.includes("amount_paid_not_greater_than_total") || causeMsg.includes("amount_paid_not_greater_than_total")) {
      res.status(400).json({ error: "סכום התשלום המצטבר יחרוג מסכום העסקה הכולל — לא ניתן להוסיף תשלום זה" });
      return;
    }
    logger.error({ err }, "POST /deals/:id/payments error");
    res.status(500).json({ error: "שגיאה בהוספת תשלום" });
  }
});

// ── POST /deals/:id/sync-credits ─────────────────────────────────────────────
// Re-creates missing credits from items_snapshot (idempotent via source_key).

router.post("/deals/:id/sync-credits", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);
  try {
    const dealRows = await db
      .select({
        id: dealsTable.id,
        customer_id: dealsTable.customer_id,
        items_snapshot: dealsTable.items_snapshot,
      })
      .from(dealsTable)
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.id, id)))
      .limit(1);

    if (dealRows.length === 0) {
      res.status(404).json({ error: "עסקה לא נמצאה" });
      return;
    }

    interface SyncComponent {
      component_id: string;
      quantity: number;
      component_name_snapshot: string;
      component_description_snapshot?: string;
    }
    interface SyncItem {
      line_id: string;
      quantity: number;
      product_id?: string;
      product_name_snapshot?: string;
      components_snapshot?: SyncComponent[];
    }

    const deal = dealRows[0];
    const items = (deal.items_snapshot ?? []) as SyncItem[];
    let created = 0;

    for (const item of items) {
      for (const comp of item.components_snapshot ?? []) {
        const totalQty = (item.quantity ?? 1) * (comp.quantity ?? 1);
        const creditSourceKey = `deal:${id}:item:${item.line_id}:component:${comp.component_id}`;
        const result = await db
          .insert(creditsTable)
          .values({
            deal_id: id,
            customer_id: deal.customer_id ?? undefined,
            source_component_id: comp.component_id,
            source_quote_item_id: item.line_id,
            source_product_id: item.product_id ?? undefined,
            parent_product_name: item.product_name_snapshot ?? null,
            credit_name: comp.component_name_snapshot,
            description: comp.component_description_snapshot ?? null,
            status: "בתהליך",
            quantity: String(totalQty),
            source_key: creditSourceKey,
          })
          .onConflictDoNothing();
        if (result.rowCount && result.rowCount > 0) created++;
      }
    }

    res.json({ success: true, created });
  } catch (err) {
    logger.error({ err }, "POST /deals/:id/sync-credits error");
    res.status(500).json({ error: "שגיאה בסנכרון קרדיטים" });
  }
});

export default router;
