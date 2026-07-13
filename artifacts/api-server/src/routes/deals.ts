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
} from "@workspace/db/schema";
import {
  isNull,
  eq,
  sql,
  and,
  desc,
} from "drizzle-orm";
import { logger } from "../lib/logger";

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
  const result = await tx.execute(sql`
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

    res.json({ ...deal, version_number });
  } catch (err) {
    logger.error({ err }, "GET /deals/:id error");
    res.status(500).json({ error: "שגיאה בטעינת העסקה" });
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

      // ── Step 5: Amount validation ───────────────────────────────────────────
      const totalsSnap = (version.totals_snapshot ?? {}) as Record<string, number>;
      const total_amount_including_vat = totalsSnap["total_with_vat"] ?? 0;

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
        const inserted = await tx
          .insert(dealsTable)
          .values({
            deal_number,
            quote_id: version.quote_id,
            customer_id: resolvedCustomerId,
            lead_id: resolvedLeadId,
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
      };
    });

    // ── Step 9: Payment creation (idempotent via source_key) ─────────────────
    if (amount_paid_including_vat > 0) {
      const PAYMENT_METHOD_MAP: Record<string, string> = {
        cash: "מזומן",
        credit_card: "אשראי",
        bank_transfer: "העברה בנקאית",
      };
      const paymentMethod = PAYMENT_METHOD_MAP[payment_type] ?? null;
      const paymentSourceKey = `deal_creation:${result.dealId}`;

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
          amount_paid: String(amount_paid_including_vat),
          installments_count: payment_type === "credit_card" ? installments_count : null,
          invoice_name: payment_type !== "credit_card" ? invoice_name : null,
          invoice_tax_id: payment_type !== "credit_card" ? invoice_id_number : null,
          invoice_email: payment_type !== "credit_card" ? invoice_email : null,
          source_type: "deal_creation",
          source_key: paymentSourceKey,
        })
        .onConflictDoNothing();
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
          })
          .onConflictDoNothing();
      }
    }

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

    res.status(500).json({ success: false, code: "INTERNAL_ERROR", error: "שגיאה פנימית ביצירת העסקה" });
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
    res.status(500).json({ error: "שגיאה פנימית בעדכון העסקה" });
  }
});

export default router;
