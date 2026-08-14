import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { dealsTable, customersTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { createPaymentLink, isInvoice4UConfigured } from "../lib/invoice4u";
import { buildPaymentMessage, buildWhatsAppLink, normalizePhoneIL } from "../lib/whatsapp-link";

const router: IRouter = Router();

const RETURN_URL_BASE = process.env.INVOICE4U_RETURN_URL ?? "";

// ── POST /deals/:id/payment-link ──────────────────────────────────────────────
// יוצר לינק תשלום (Invoice4U + משולם) לעסקה ומחזיר את ה-URL.
// גוף אופציונלי: { amount?, installments?, description? }
// ברירת מחדל לסכום: היתרה לתשלום (remaining_amount), ואם אין — הסכום כולל מע"מ.
router.post("/deals/:id/payment-link", async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params["id"]);

  if (!isInvoice4UConfigured()) {
    res.status(503).json({ error: "אינטגרציית Invoice4U לא מוגדרת (חסר INVOICE4U_API_KEY)" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: dealsTable.id,
        deal_number: dealsTable.deal_number,
        total_amount_including_vat: dealsTable.total_amount_including_vat,
        amount_paid_including_vat: dealsTable.amount_paid_including_vat,
        installments_count: dealsTable.installments_count,
        quote_link: dealsTable.quote_link,
        invoice_name: dealsTable.invoice_name,
        invoice_email: dealsTable.invoice_email,
        customer_name: customersTable.name,
        customer_phone: customersTable.phone,
        customer_email: customersTable.email,
      })
      .from(dealsTable)
      .leftJoin(customersTable, eq(dealsTable.customer_id, customersTable.id))
      .where(and(isNull(dealsTable.deleted_at), eq(dealsTable.id, id)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "עסקה לא נמצאה" });
      return;
    }
    const deal = rows[0]!;

    const body = (req.body ?? {}) as {
      amount?: number | string;
      installments?: number | string;
      description?: string;
    };

    // סכום (תמיד כולל מע"מ): override מהגוף → יתרה לתשלום כולל מע"מ → סכום כולל מע"מ.
    // אין שדה "יתרה כולל מע"מ" בסכמה, לכן מחשבים: סה"כ כולל מע"מ − ששולם כולל מע"מ.
    const override = body.amount != null ? Number(body.amount) : NaN;
    const totalIncVat = Number(deal.total_amount_including_vat ?? NaN);
    const paidIncVat = Number(deal.amount_paid_including_vat ?? 0);
    const remainingIncVat = Number.isFinite(totalIncVat)
      ? totalIncVat - (Number.isFinite(paidIncVat) ? paidIncVat : 0)
      : NaN;
    const sum = Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(remainingIncVat) && remainingIncVat > 0
      ? remainingIncVat
      : totalIncVat;

    if (!Number.isFinite(sum) || sum <= 0) {
      res.status(400).json({ error: "לא ניתן לקבוע סכום לתשלום עבור העסקה" });
      return;
    }

    const installments =
      body.installments != null ? Number(body.installments) : Number(deal.installments_count ?? 1);

    const fullName = deal.invoice_name || deal.customer_name || "לקוח";
    const email = deal.invoice_email || deal.customer_email || null;

    const result = await createPaymentLink({
      sum,
      fullName,
      email,
      phone: deal.customer_phone ?? null,
      installments: Number.isFinite(installments) ? installments : 1,
      description: body.description ?? `תשלום עבור עסקה ${deal.deal_number ?? ""}`.trim(),
      externalId: deal.deal_number ?? deal.id,
      returnUrl: RETURN_URL_BASE || null,
    });

    if (!result.ok || !result.url) {
      res.status(502).json({ error: result.error ?? "כשל ביצירת לינק תשלום" });
      return;
    }

    // הודעת WhatsApp מוכנה לעריכה + לינק שפותח את ה-WhatsApp Web של איש המכירות.
    const message = buildPaymentMessage({
      customerName: deal.customer_name || fullName,
      paymentUrl: result.url,
      quoteLink: deal.quote_link ?? null,
    });
    const phone = normalizePhoneIL(deal.customer_phone);
    const whatsappUrl = buildWhatsAppLink(deal.customer_phone, message);

    res.json({
      payment_url: result.url,
      clearing_id: result.clearingId ?? null,
      amount: sum,
      phone,
      message,
      whatsapp_url: whatsappUrl,
    });
  } catch (err) {
    logger.error({ err }, "POST /deals/:id/payment-link error");
    res.status(500).json({ error: "שגיאה ביצירת לינק תשלום" });
  }
});

export default router;
