import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  quotesTable,
  quoteVersionsTable,
  quoteProductsTable,
  quoteComponentsTable,
  customersTable,
  leadsTable,
  insertLeadSchema,
} from "@workspace/db/schema";
import { isNull, eq, sql, and, desc, asc, or, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

async function generateQuoteNumber(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(
      CAST(REGEXP_REPLACE(quote_number, '[^0-9]', '', 'g') AS BIGINT)
    ), 999) + 1 AS next_num
    FROM quotes
    WHERE deleted_at IS NULL
      AND quote_number ~ '^Q-[0-9]+'
  `);
  const nextNum = (result.rows[0] as Record<string, unknown>)?.["next_num"] ?? 1000;
  return `Q-${String(nextNum).padStart(4, "0")}`;
}

// ── GET /quotes/phone-lookup ──────────────────────────────────────────────────
router.get("/quotes/phone-lookup", async (req: Request, res: Response): Promise<void> => {
  const raw = typeof req.query["phone"] === "string" ? req.query["phone"].trim() : "";
  if (!raw) {
    res.status(400).json({ error: "חובה להזין מספר טלפון" });
    return;
  }
  const normalized = normalizePhone(raw);
  try {
    const [customers, leads] = await Promise.all([
      db.select().from(customersTable).where(
        and(isNull(customersTable.deleted_at), ilike(customersTable.phone, `%${normalized}%`))
      ).limit(1),
      db.select().from(leadsTable).where(
        and(isNull(leadsTable.deleted_at), ilike(leadsTable.phone, `%${normalized}%`))
      ).limit(1),
    ]);
    if (customers.length > 0) {
      const c = customers[0];
      res.json({ found: "customer", id: c.id, name: c.name, phone: c.phone, email: c.email, tax_id: c.tax_id });
    } else if (leads.length > 0) {
      const l = leads[0];
      res.json({ found: "lead", id: l.id, name: l.name, phone: l.phone, email: l.email });
    } else {
      res.json({ found: "none" });
    }
  } catch (err) {
    logger.error({ err }, "phone-lookup error");
    res.status(500).json({ error: "שגיאה בחיפוש טלפון" });
  }
});

// ── GET /quotes ───────────────────────────────────────────────────────────────
router.get("/quotes", async (req: Request, res: Response): Promise<void> => {
  try {
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : "";
    const status = typeof req.query["status"] === "string" ? req.query["status"].trim() : "";
    const limit = Math.min(Number(req.query["limit"] ?? 100), 300);
    const offset = Number(req.query["offset"] ?? 0);

    const rows = await db.execute(sql`
      SELECT
        q.id,
        q.quote_number,
        q.status,
        q.customer_id,
        q.lead_id,
        q.discount_amount,
        q.created_at,
        q.updated_at,
        q.current_version_id,
        c.name   AS customer_name,
        c.phone  AS customer_phone,
        l.name   AS lead_name,
        l.phone  AS lead_phone,
        qv.version_number,
        qv.status             AS version_status,
        qv.terms_snapshot,
        qv.totals_snapshot,
        qv.sent_at,
        qv.approved_at,
        qv.locked_at
      FROM quotes q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN leads l     ON l.id = q.lead_id
      LEFT JOIN quote_versions qv ON qv.id = q.current_version_id
      WHERE q.deleted_at IS NULL
        ${search ? sql`AND (
          q.quote_number ILIKE ${"%" + search + "%"}
          OR c.name ILIKE ${"%" + search + "%"}
          OR l.name ILIKE ${"%" + search + "%"}
          OR c.phone ILIKE ${"%" + search + "%"}
          OR l.phone ILIKE ${"%" + search + "%"}
        )` : sql``}
        ${status ? sql`AND q.status = ${status}` : sql``}
      ORDER BY q.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int AS total FROM quotes q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN leads l     ON l.id = q.lead_id
      WHERE q.deleted_at IS NULL
        ${search ? sql`AND (
          q.quote_number ILIKE ${"%" + search + "%"}
          OR c.name ILIKE ${"%" + search + "%"}
          OR l.name ILIKE ${"%" + search + "%"}
          OR c.phone ILIKE ${"%" + search + "%"}
          OR l.phone ILIKE ${"%" + search + "%"}
        )` : sql``}
        ${status ? sql`AND q.status = ${status}` : sql``}
    `);

    const total = (countResult.rows[0] as Record<string, number>)?.["total"] ?? 0;
    res.setHeader("X-Total-Count", String(total));
    res.json(rows.rows);
  } catch (err) {
    logger.error({ err }, "Failed to list quotes");
    res.status(500).json({ error: "שגיאה בטעינת הצעות המחיר" });
  }
});

// ── GET /quotes/:id ───────────────────────────────────────────────────────────
router.get("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params["id"]);
    const rows = await db.execute(sql`
      SELECT
        q.*,
        c.name   AS customer_name,
        c.phone  AS customer_phone,
        c.email  AS customer_email,
        l.name   AS lead_name,
        l.phone  AS lead_phone,
        l.email  AS lead_email
      FROM quotes q
      LEFT JOIN customers c ON c.id = q.customer_id
      LEFT JOIN leads l     ON l.id = q.lead_id
      WHERE q.id = ${id} AND q.deleted_at IS NULL
    `);
    if (!rows.rows[0]) {
      res.status(404).json({ error: "הצעת המחיר לא נמצאה" });
      return;
    }
    const quote = rows.rows[0];

    // current version
    const verRows = await db.execute(sql`
      SELECT * FROM quote_versions WHERE id = (
        SELECT current_version_id FROM quotes WHERE id = ${id}
      )
    `);
    // all versions
    const allVersions = await db.execute(sql`
      SELECT id, version_number, status, created_at, sent_at, approved_at, locked_at
      FROM quote_versions WHERE quote_id = ${id} ORDER BY version_number ASC
    `);

    res.json({ quote, currentVersion: verRows.rows[0] ?? null, versions: allVersions.rows });
  } catch (err) {
    logger.error({ err }, "Failed to get quote");
    res.status(500).json({ error: "שגיאה בטעינת הצעת המחיר" });
  }
});

// ── POST /quotes ──────────────────────────────────────────────────────────────
router.post("/quotes", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateQuoteBody;

    // 1. Resolve party
    let customerId: string | null = null;
    let leadId: string | null = null;

    if (body.party_type === "customer" && body.party_id) {
      customerId = body.party_id;
    } else if (body.party_type === "lead" && body.party_id) {
      leadId = body.party_id;
    } else if (body.party_type === "new") {
      // Create a new lead
      const newLeadNum = await db.execute(sql`
        SELECT COALESCE(MAX(
          CAST(REGEXP_REPLACE(lead_number, '[^0-9]', '', 'g') AS BIGINT)
        ), 0) + 1 AS next_num FROM leads WHERE deleted_at IS NULL AND lead_number ~ '^L-[0-9]+'
      `);
      const nn = (newLeadNum.rows[0] as Record<string, unknown>)?.["next_num"] ?? 1;
      const leadNumber = `L-${String(nn).padStart(6, "0")}`;
      const [createdLead] = await db.insert(leadsTable).values({
        lead_number: leadNumber,
        name: body.new_party_name ?? "ליד חדש",
        phone: body.new_party_phone ?? null,
        email: body.new_party_email ?? null,
        status: "ליד חדש",
        lead_created_at: new Date(),
      }).returning({ id: leadsTable.id });
      leadId = createdLead?.id ?? null;
    }

    if (!customerId && !leadId) {
      res.status(400).json({ error: "חובה לקשר הצעה ללקוח או ליד" });
      return;
    }

    // 2. Generate quote number
    const quoteNumber = body.quote_number || await generateQuoteNumber();

    // 3. Build party_snapshot
    let partySnapshot: PartySnapshot;
    if (customerId) {
      const c = await db.select().from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      const customer = c[0];
      partySnapshot = {
        party_type: "customer",
        source_id: customerId,
        business_name: customer?.name ?? "",
        contact_name: customer?.name ?? "",
        phone: customer?.phone ?? null,
        normalized_phone: customer?.phone ? normalizePhone(customer.phone) : null,
        email: customer?.email ?? null,
        tax_id: customer?.tax_id ?? null,
      };
    } else {
      const l = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId!)).limit(1);
      const lead = l[0];
      partySnapshot = {
        party_type: "lead",
        source_id: leadId!,
        business_name: lead?.name ?? "",
        contact_name: lead?.name ?? "",
        phone: lead?.phone ?? null,
        normalized_phone: lead?.phone ? normalizePhone(lead.phone) : null,
        email: lead?.email ?? null,
        lead_source: lead?.lead_source ?? null,
      };
    }

    // 4. Build items_snapshot
    const VAT_RATE = 0.18;
    const itemsSnapshot = (body.items ?? []).map((item) => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.unit_price) || 0;
      const lineSubtotal = qty * price;
      const vatAmount = lineSubtotal * VAT_RATE;
      const components = (item.components ?? []).map((comp) => ({
        component_id: comp.component_id ?? null,
        component_name_snapshot: comp.component_name_snapshot ?? "",
        component_description_snapshot: comp.component_description_snapshot ?? "",
        quantity: Number(comp.quantity) || 1,
        unit_cost_snapshot: Number(comp.unit_cost_snapshot) || 0,
        total_cost_snapshot: (Number(comp.quantity) || 1) * (Number(comp.unit_cost_snapshot) || 0),
        customer_note: comp.customer_note ?? null,
        internal_note: comp.internal_note ?? null,
      }));
      const internalCost = components.reduce((s, c) => s + c.total_cost_snapshot, 0);
      return {
        line_id: item.line_id ?? crypto.randomUUID(),
        source_type: item.source_type ?? "product",
        product_id: item.product_id ?? null,
        product_name_snapshot: item.product_name_snapshot ?? "",
        product_description_snapshot: item.product_description_snapshot ?? "",
        quantity: qty,
        unit_price: price,
        price_includes_vat: false,
        manual_price_override: item.manual_price_override ?? false,
        price_override_reason: item.price_override_reason ?? null,
        quantity_change_reason: item.quantity_change_reason ?? null,
        customer_note: item.customer_note ?? null,
        internal_note: item.internal_note ?? null,
        line_subtotal: lineSubtotal,
        line_total_before_vat: lineSubtotal,
        vat_rate: VAT_RATE,
        vat_amount: vatAmount,
        line_total_with_vat: lineSubtotal + vatAmount,
        components_snapshot: components,
        internal_cost_snapshot: internalCost,
        gross_profit_amount: lineSubtotal - internalCost,
        gross_profit_percent: lineSubtotal > 0 ? Math.round(((lineSubtotal - internalCost) / lineSubtotal) * 100) : 0,
      };
    });

    // 5. Build totals_snapshot
    const productsCalcTotal = itemsSnapshot.reduce((s, i) => s + i.line_subtotal, 0);
    const discountAmount = Number(body.discount_amount) || 0;
    const basketManuallyOverridden = body.basket_manually_overridden ?? false;
    const basketManualTotal = basketManuallyOverridden ? Number(body.basket_manual_total) : null;
    const basketAdjustment = basketManuallyOverridden && basketManualTotal !== null
      ? basketManualTotal - productsCalcTotal
      : 0;
    const effectiveSubtotal = basketManuallyOverridden && basketManualTotal !== null
      ? basketManualTotal
      : productsCalcTotal;
    const subtotalAfterDiscount = Math.max(0, effectiveSubtotal - discountAmount);
    const vatAmount = subtotalAfterDiscount * VAT_RATE;
    const totalWithVat = subtotalAfterDiscount + vatAmount;
    const costTotal = itemsSnapshot.reduce((s, i) => s + i.internal_cost_snapshot, 0);

    const totalsSnapshot = {
      products_calculated_total: productsCalcTotal,
      basket_total_before_discount: effectiveSubtotal,
      basket_total_manually_overridden: basketManuallyOverridden,
      basket_manual_total: basketManualTotal,
      basket_adjustment_amount: basketAdjustment,
      basket_override_note: body.basket_override_note ?? null,
      subtotal_before_discount: effectiveSubtotal,
      discount_amount: discountAmount,
      subtotal_after_discount: subtotalAfterDiscount,
      vat_rate: VAT_RATE,
      vat_amount: vatAmount,
      total_with_vat: totalWithVat,
      cost_total: costTotal,
      gross_profit_amount: subtotalAfterDiscount - costTotal,
      gross_profit_percent: subtotalAfterDiscount > 0
        ? Math.round(((subtotalAfterDiscount - costTotal) / subtotalAfterDiscount) * 100)
        : 0,
    };

    // 6. terms_snapshot
    const depositAmount = Number(body.deposit_amount) || 0;
    const termsSnapshot = {
      project_title: body.project_title ?? null,
      valid_until: body.valid_until ?? null,
      payment_terms: body.payment_terms ?? null,
      deposit_amount: depositAmount,
      remaining_balance: Math.max(0, totalWithVat - depositAmount),
      delivery_terms: body.delivery_terms ?? null,
      generate_pdf: body.generate_pdf ?? false,
    };

    // 7. notes_snapshot
    const notesSnapshot = {
      customer_notes: body.customer_notes ?? null,
      operation_notes: body.operation_notes ?? null,
      internal_notes: body.internal_notes ?? null,
    };

    // 8. Insert atomically
    const [insertedQuote] = await db.insert(quotesTable).values({
      quote_number: quoteNumber,
      customer_id: customerId,
      lead_id: leadId,
      discount_amount: String(discountAmount),
      customer_notes: body.customer_notes ?? null,
      operation_notes: body.operation_notes ?? null,
      internal_notes: body.internal_notes ?? null,
      status: body.send_immediately ? "sent" : "draft",
    }).returning();

    const [insertedVersion] = await db.insert(quoteVersionsTable).values({
      quote_id: insertedQuote.id,
      version_number: 1,
      status: body.send_immediately ? "sent" : "draft",
      party_snapshot: partySnapshot,
      items_snapshot: itemsSnapshot,
      totals_snapshot: totalsSnapshot,
      terms_snapshot: termsSnapshot,
      notes_snapshot: notesSnapshot,
      sent_at: body.send_immediately ? new Date() : null,
      locked_at: body.send_immediately ? new Date() : null,
    }).returning();

    // Update current_version_id
    await db.update(quotesTable)
      .set({ current_version_id: insertedVersion.id, updated_at: new Date() })
      .where(eq(quotesTable.id, insertedQuote.id));

    // Insert quote_products and quote_components for draft editing
    if (!body.send_immediately) {
      for (let i = 0; i < (body.items ?? []).length; i++) {
        const item = (body.items ?? [])[i];
        const snap = itemsSnapshot[i];
        const [qp] = await db.insert(quoteProductsTable).values({
          quote_id: insertedQuote.id,
          source_product_id: item.product_id ?? null,
          product_name_snapshot: snap.product_name_snapshot,
          category_snapshot: item.category_snapshot ?? null,
          deliverable_type_snapshot: item.deliverable_type_snapshot ?? null,
          description_snapshot: snap.product_description_snapshot,
          original_quantity: String(snap.quantity),
          original_unit_price: String(snap.unit_price),
          quantity: String(snap.quantity),
          unit_price: String(snap.unit_price),
          total_price: String(snap.line_subtotal),
          price_override_reason: snap.price_override_reason,
          customer_note: snap.customer_note,
          internal_note: snap.internal_note,
          sort_order: i,
        }).returning();

        for (let j = 0; j < snap.components_snapshot.length; j++) {
          const comp = snap.components_snapshot[j];
          await db.insert(quoteComponentsTable).values({
            quote_product_id: qp.id,
            source_component_id: comp.component_id,
            component_name_snapshot: comp.component_name_snapshot,
            description_snapshot: comp.component_description_snapshot,
            original_quantity: String(comp.quantity),
            original_unit_price: String(comp.unit_cost_snapshot),
            quantity: String(comp.quantity),
            unit_price: String(comp.unit_cost_snapshot),
            total_price: String(comp.total_cost_snapshot),
            customer_note: comp.customer_note,
            internal_note: comp.internal_note,
            sort_order: j,
          });
        }
      }
    }

    res.status(201).json({
      quote: { ...insertedQuote, current_version_id: insertedVersion.id },
      version: insertedVersion,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create quote");
    res.status(500).json({ error: "שגיאה ביצירת הצעת המחיר" });
  }
});

// ── PATCH /quotes/:id/status ──────────────────────────────────────────────────
router.patch("/quotes/:id/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const quoteId = String(req.params["id"]);
    const { status, version_id } = req.body as { status: string; version_id?: string };

    const validStatuses = ["draft", "sent", "approved", "rejected", "expired", "cancelled"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "סטטוס לא תקין" });
      return;
    }

    // Get quote to find current version
    const quotes = await db.select().from(quotesTable).where(
      and(eq(quotesTable.id, quoteId), isNull(quotesTable.deleted_at))
    ).limit(1);
    if (!quotes[0]) {
      res.status(404).json({ error: "הצעת המחיר לא נמצאה" });
      return;
    }

    const targetVersionId = version_id ?? quotes[0].current_version_id;
    if (!targetVersionId) {
      res.status(400).json({ error: "לא נמצאה גרסה לעדכון" });
      return;
    }

    // Check if version is locked
    const versions = await db.select().from(quoteVersionsTable).where(
      eq(quoteVersionsTable.id, targetVersionId)
    ).limit(1);
    const ver = versions[0];
    if (!ver) {
      res.status(404).json({ error: "גרסת ההצעה לא נמצאה" });
      return;
    }
    if (ver.locked_at && status === "draft") {
      res.status(400).json({ error: "לא ניתן לעריכת גרסה נעולה" });
      return;
    }

    const now = new Date();
    await db.update(quoteVersionsTable)
      .set({
        status,
        updated_at: now,
        sent_at: status === "sent" ? now : undefined,
        approved_at: status === "approved" ? now : undefined,
        rejected_at: status === "rejected" ? now : undefined,
        cancelled_at: status === "cancelled" ? now : undefined,
        locked_at: ["sent","approved","rejected","cancelled"].includes(status) ? now : undefined,
      })
      .where(eq(quoteVersionsTable.id, targetVersionId));

    await db.update(quotesTable)
      .set({ status, updated_at: now })
      .where(eq(quotesTable.id, quoteId));

    res.json({ success: true, status });
  } catch (err) {
    logger.error({ err }, "Failed to update quote status");
    res.status(500).json({ error: "שגיאה בעדכון סטטוס ההצעה" });
  }
});

// ── POST /quotes/:id/new-version ─────────────────────────────────────────────
router.post("/quotes/:id/new-version", async (req: Request, res: Response): Promise<void> => {
  try {
    const quoteId = String(req.params["id"]);
    const { items, totals_snapshot, terms_snapshot, notes_snapshot, party_snapshot, discount_amount } = req.body;

    const quotes = await db.select().from(quotesTable).where(
      and(eq(quotesTable.id, quoteId), isNull(quotesTable.deleted_at))
    ).limit(1);
    if (!quotes[0]) {
      res.status(404).json({ error: "הצעת המחיר לא נמצאה" });
      return;
    }

    // Find max version number
    const maxVer = await db.execute(sql`
      SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM quote_versions WHERE quote_id = ${quoteId}
    `);
    const nextVer = ((maxVer.rows[0] as Record<string, number>)?.["max_ver"] ?? 0) + 1;

    // Load current version as base if no items provided
    const currentVersionRows = await db.select().from(quoteVersionsTable).where(
      eq(quoteVersionsTable.id, quotes[0].current_version_id ?? "")
    ).limit(1);
    const base = currentVersionRows[0];

    const [newVersion] = await db.insert(quoteVersionsTable).values({
      quote_id: quoteId,
      version_number: nextVer,
      status: "draft",
      party_snapshot: party_snapshot ?? base?.party_snapshot ?? {},
      items_snapshot: items ?? base?.items_snapshot ?? [],
      totals_snapshot: totals_snapshot ?? base?.totals_snapshot ?? {},
      terms_snapshot: terms_snapshot ?? base?.terms_snapshot ?? {},
      notes_snapshot: notes_snapshot ?? base?.notes_snapshot ?? {},
    }).returning();

    await db.update(quotesTable)
      .set({ current_version_id: newVersion.id, status: "draft", updated_at: new Date() })
      .where(eq(quotesTable.id, quoteId));

    res.status(201).json({ version: newVersion });
  } catch (err) {
    logger.error({ err }, "Failed to create new quote version");
    res.status(500).json({ error: "שגיאה ביצירת גרסה חדשה" });
  }
});

// ── POST /quotes/:id/duplicate ────────────────────────────────────────────────
router.post("/quotes/:id/duplicate", async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceQuoteId = String(req.params["id"]);
    const {
      party_type, party_id, new_party_name, new_party_phone, new_party_email,
      refresh_party,
    } = req.body as {
      party_type?: "same" | "customer" | "lead" | "new";
      party_id?: string;
      new_party_name?: string;
      new_party_phone?: string;
      new_party_email?: string;
      refresh_party?: boolean;
    };

    // Load source quote
    const sourceQuotes = await db.select().from(quotesTable).where(
      and(eq(quotesTable.id, sourceQuoteId), isNull(quotesTable.deleted_at))
    ).limit(1);
    if (!sourceQuotes[0]) {
      res.status(404).json({ error: "הצעת המחיר המקורית לא נמצאה" });
      return;
    }
    const sourceQuote = sourceQuotes[0];

    // Load source version
    const sourceVersionRows = await db.select().from(quoteVersionsTable).where(
      eq(quoteVersionsTable.id, sourceQuote.current_version_id ?? "")
    ).limit(1);
    if (!sourceVersionRows[0]) {
      res.status(400).json({ error: "לא נמצאה גרסת מקור תקינה" });
      return;
    }
    const sourceVersion = sourceVersionRows[0];

    // Determine new party
    let newCustomerId: string | null = null;
    let newLeadId: string | null = null;
    let partySnapshot = sourceVersion.party_snapshot as PartySnapshot;

    if (!party_type || party_type === "same") {
      newCustomerId = sourceQuote.customer_id;
      newLeadId = sourceQuote.lead_id;
      if (refresh_party) {
        if (newCustomerId) {
          const c = await db.select().from(customersTable).where(eq(customersTable.id, newCustomerId)).limit(1);
          if (c[0]) {
            partySnapshot = {
              party_type: "customer", source_id: newCustomerId,
              business_name: c[0].name, contact_name: c[0].name,
              phone: c[0].phone, normalized_phone: c[0].phone ? normalizePhone(c[0].phone) : null,
              email: c[0].email, tax_id: c[0].tax_id,
            };
          }
        } else if (newLeadId) {
          const l = await db.select().from(leadsTable).where(eq(leadsTable.id, newLeadId)).limit(1);
          if (l[0]) {
            partySnapshot = {
              party_type: "lead", source_id: newLeadId,
              business_name: l[0].name, contact_name: l[0].name,
              phone: l[0].phone, normalized_phone: l[0].phone ? normalizePhone(l[0].phone) : null,
              email: l[0].email, lead_source: l[0].lead_source,
            };
          }
        }
      }
    } else if (party_type === "customer" && party_id) {
      newCustomerId = party_id;
      const c = await db.select().from(customersTable).where(eq(customersTable.id, party_id)).limit(1);
      if (c[0]) {
        partySnapshot = {
          party_type: "customer", source_id: party_id,
          business_name: c[0].name, contact_name: c[0].name,
          phone: c[0].phone, normalized_phone: c[0].phone ? normalizePhone(c[0].phone) : null,
          email: c[0].email, tax_id: c[0].tax_id,
        };
      }
    } else if (party_type === "lead" && party_id) {
      newLeadId = party_id;
      const l = await db.select().from(leadsTable).where(eq(leadsTable.id, party_id)).limit(1);
      if (l[0]) {
        partySnapshot = {
          party_type: "lead", source_id: party_id,
          business_name: l[0].name, contact_name: l[0].name,
          phone: l[0].phone, normalized_phone: l[0].phone ? normalizePhone(l[0].phone) : null,
          email: l[0].email, lead_source: l[0].lead_source,
        };
      }
    } else if (party_type === "new") {
      const newLeadNum = await db.execute(sql`
        SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(lead_number,'[^0-9]','','g') AS BIGINT)),0)+1 AS n
        FROM leads WHERE deleted_at IS NULL AND lead_number ~ '^L-[0-9]+'
      `);
      const nn = (newLeadNum.rows[0] as Record<string, unknown>)?.["n"] ?? 1;
      const [createdLead] = await db.insert(leadsTable).values({
        lead_number: `L-${String(nn).padStart(6, "0")}`,
        name: new_party_name ?? "ליד חדש",
        phone: new_party_phone ?? null,
        email: new_party_email ?? null,
        status: "ליד חדש",
        lead_created_at: new Date(),
      }).returning({ id: leadsTable.id });
      newLeadId = createdLead?.id ?? null;
      partySnapshot = {
        party_type: "lead", source_id: newLeadId ?? "",
        business_name: new_party_name ?? "", contact_name: new_party_name ?? "",
        phone: new_party_phone ?? null, normalized_phone: new_party_phone ? normalizePhone(new_party_phone) : null,
        email: new_party_email ?? null,
      };
    }

    const newQuoteNumber = await generateQuoteNumber();

    const [newQuote] = await db.insert(quotesTable).values({
      quote_number: newQuoteNumber,
      customer_id: newCustomerId,
      lead_id: newLeadId,
      discount_amount: sourceQuote.discount_amount,
      status: "draft",
    }).returning();

    // Note source in notes_snapshot
    const origNotes = (sourceVersion.notes_snapshot as Record<string, unknown>) ?? {};
    const newNotes = {
      ...origNotes,
      internal_notes: `${origNotes["internal_notes"] ? origNotes["internal_notes"] + "\n" : ""}[מבוסס על הצעה ${sourceQuote.quote_number}]`,
    };

    const [newVersion] = await db.insert(quoteVersionsTable).values({
      quote_id: newQuote.id,
      version_number: 1,
      status: "draft",
      party_snapshot: partySnapshot,
      items_snapshot: sourceVersion.items_snapshot ?? [],
      totals_snapshot: sourceVersion.totals_snapshot ?? {},
      terms_snapshot: sourceVersion.terms_snapshot ?? {},
      notes_snapshot: newNotes,
    }).returning();

    await db.update(quotesTable)
      .set({ current_version_id: newVersion.id })
      .where(eq(quotesTable.id, newQuote.id));

    res.status(201).json({
      quote: { ...newQuote, current_version_id: newVersion.id },
      version: newVersion,
      source_quote_number: sourceQuote.quote_number,
    });
  } catch (err) {
    logger.error({ err }, "Failed to duplicate quote");
    res.status(500).json({ error: "שגיאה בשכפול הצעת המחיר" });
  }
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface PartySnapshot {
  party_type: "customer" | "lead";
  source_id: string;
  business_name: string;
  contact_name: string;
  phone: string | null | undefined;
  normalized_phone: string | null;
  email: string | null | undefined;
  tax_id?: string | null | undefined;
  lead_source?: string | null | undefined;
}

interface BasketComponent {
  component_id?: string;
  component_name_snapshot?: string;
  component_description_snapshot?: string;
  quantity?: number | string;
  unit_cost_snapshot?: number | string;
  customer_note?: string;
  internal_note?: string;
}

interface BasketItem {
  line_id?: string;
  source_type?: "product" | "manual";
  product_id?: string;
  product_name_snapshot?: string;
  product_description_snapshot?: string;
  category_snapshot?: string;
  deliverable_type_snapshot?: string;
  quantity?: number | string;
  unit_price?: number | string;
  manual_price_override?: boolean;
  price_override_reason?: string;
  quantity_change_reason?: string;
  customer_note?: string;
  internal_note?: string;
  components?: BasketComponent[];
}

interface CreateQuoteBody {
  party_type: "customer" | "lead" | "new";
  party_id?: string;
  new_party_name?: string;
  new_party_phone?: string;
  new_party_email?: string;
  quote_number?: string;
  project_title?: string;
  valid_until?: string;
  items?: BasketItem[];
  discount_amount?: number | string;
  basket_manually_overridden?: boolean;
  basket_manual_total?: number | string;
  basket_override_note?: string;
  payment_terms?: string;
  deposit_amount?: number | string;
  delivery_terms?: string;
  customer_notes?: string;
  operation_notes?: string;
  internal_notes?: string;
  generate_pdf?: boolean;
  send_immediately?: boolean;
}

export default router;
