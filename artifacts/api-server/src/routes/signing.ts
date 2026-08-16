import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { quotesTable, quoteVersionsTable, customersTable, leadsTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { supabaseAdmin } from "../lib/supabase-admin";
import { createPaymentLink, getClearingStatus, isInvoice4UConfigured } from "../lib/invoice4u";
import { buildOnboardingMessage, buildWhatsAppLink, normalizePhoneIL } from "../lib/whatsapp-link";
import { sendSalespersonNotification, resolveSalespersonPhone } from "../lib/invoiceWebhook";
import { sendSignedEmail } from "../lib/email";

const router: IRouter = Router();

const RETURN_URL_BASE = process.env.INVOICE4U_RETURN_URL ?? "";
const PDF_BUCKET = "quote-pdfs";
const SIGNING_TTL_DAYS = Number(process.env.SIGNING_TOKEN_TTL_DAYS ?? 14);

// בסיס הכתובת לבניית לינק החתימה הציבורי. עדיף להגדיר PUBLIC_APP_URL במפורש;
// אחרת נגזר מכותרת ה-Host של הבקשה.
function publicBaseUrl(req: Request): string {
  const env = (process.env.PUBLIC_APP_URL ?? "").trim();
  if (env) return env.replace(/\/+$/, "");
  return `https://${req.get("host")}`.replace(/\/+$/, "");
}

// ── POST /quotes/:id/onboarding ───────────────────────────────────────────────
// ממסך הצעת המחיר: מייצר לינק חתימה (עמוד ציבורי ל-PDF) + לינק לדף פרטי חשבונית
// (/pay/:token), ובונה הודעת WhatsApp מוכנה לעריכה.
router.post("/quotes/:id/onboarding", async (req: Request, res: Response): Promise<void> => {
  const quoteId = String(req.params["id"]);

  try {
    // ── 1. טעינת הצעה + לקוח + ליד (fallback לטלפון/שם) ─────────────────────────
    const rows = await db
      .select({
        quote_id: quotesTable.id,
        quote_number: quotesTable.quote_number,
        current_version_id: quotesTable.current_version_id,
        customer_id: quotesTable.customer_id,
        lead_id: quotesTable.lead_id,
        customer_name: customersTable.name,
        customer_phone: customersTable.phone,
        customer_email: customersTable.email,
        invoice_name: customersTable.invoice_name,
        invoice_email: customersTable.invoice_email,
        lead_name: leadsTable.name,
        lead_phone: leadsTable.phone,
        lead_email: leadsTable.email,
      })
      .from(quotesTable)
      .leftJoin(customersTable, eq(quotesTable.customer_id, customersTable.id))
      .leftJoin(leadsTable, eq(quotesTable.lead_id, leadsTable.id))
      .where(and(isNull(quotesTable.deleted_at), eq(quotesTable.id, quoteId)))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "הצעת מחיר לא נמצאה" });
      return;
    }
    const quote = rows[0]!;

    const versionId = quote.current_version_id;
    if (!versionId) {
      res.status(400).json({ error: "להצעה אין גרסה פעילה" });
      return;
    }

    // ── 2. סכום כולל מע"מ + party_snapshot לשם איש הקשר ─────────────────────
    const verRows = await db
      .select({
        id: quoteVersionsTable.id,
        version_number: quoteVersionsTable.version_number,
        totals_snapshot: quoteVersionsTable.totals_snapshot,
        party_snapshot: quoteVersionsTable.party_snapshot,
      })
      .from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.id, versionId))
      .limit(1);

    if (verRows.length === 0) {
      res.status(404).json({ error: "גרסת ההצעה לא נמצאה" });
      return;
    }
    const totals = (verRows[0]!.totals_snapshot ?? {}) as { total_with_vat?: number };
    const partySnap = (verRows[0]!.party_snapshot ?? {}) as { contact_name?: string; business_name?: string };
    const sum = Number(totals.total_with_vat ?? NaN);
    if (!Number.isFinite(sum) || sum <= 0) {
      res.status(400).json({ error: "לא ניתן לקבוע סכום כולל מע\"מ עבור ההצעה" });
      return;
    }

    // ── 3. איתור ה-PDF האחרון שהופק לגרסה (חובה שיהיה קיים) ──────────────────
    const { data: doc } = await supabaseAdmin
      .from("quote_documents")
      .select("id, storage_path, revision")
      .eq("quote_version_id", versionId)
      .not("storage_path", "is", null)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!doc?.storage_path) {
      res.status(409).json({ error: "צריך להפיק PDF להצעה קודם (כפתור 'פתח הצעת מחיר - PDF')" });
      return;
    }

    // ── 4. יצירת בקשת חתימה (token) ──────────────────────────────────────────
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + SIGNING_TTL_DAYS * 86_400_000).toISOString();

    const { data: sr, error: srErr } = await supabaseAdmin
      .from("signing_requests")
      .insert({
        token,
        quote_id: quoteId,
        quote_version_id: versionId,
        customer_id: quote.customer_id ?? null,
        status: "pending",
        pdf_document_id: doc.id,
        unsigned_pdf_path: doc.storage_path,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (srErr || !sr) {
      logger.error({ err: srErr }, "signing_requests insert failed");
      res.status(500).json({ error: "שגיאה ביצירת בקשת חתימה (בדוק שקיימת הטבלה signing_requests)" });
      return;
    }

    // ── 5. לינקים: חתימה + דף פרטי חשבונית (/pay/:token) ────────────────────
    const signingUrl = `${publicBaseUrl(req)}/sign/${token}`;
    const paymentUrl = `${publicBaseUrl(req)}/pay/${token}`;

    const contactPhone = quote.customer_phone ?? quote.lead_phone ?? null;

    // ── 6. בניית ההודעה + לינק ה-WhatsApp ────────────────────────────────────
    const fullName = quote.invoice_name || quote.customer_name || quote.lead_name || "לקוח";
    const greetingName =
      partySnap.contact_name ||
      quote.customer_name ||
      quote.lead_name ||
      fullName;

    const message = buildOnboardingMessage({
      customerName: greetingName,
      signingUrl,
      paymentUrl,
    });
    const phone = normalizePhoneIL(contactPhone);
    const whatsappUrl = buildWhatsAppLink(contactPhone, message);

    res.json({
      signing_url: signingUrl,
      payment_url: paymentUrl,
      amount: sum,
      phone,
      message,
      whatsapp_url: whatsappUrl,
    });
  } catch (err) {
    logger.error({ err }, "POST /quotes/:id/onboarding error");
    res.status(500).json({ error: "שגיאה ביצירת לינקים לשליחה" });
  }
});

// ── GET /public/pay/:token ────────────────────────────────────────────────────
// ציבורי: טוען פרטי פרה-פיל לטופס החשבונית (invoice_name, tax_id, email, amount).
router.get("/public/pay/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params["token"]);
  try {
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, quote_version_id, customer_id, payment_status, invoice_name, invoice_tax_id, invoice_email, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!sr) {
      res.status(404).json({ error: "הקישור לא נמצא" });
      return;
    }

    if (sr.payment_status === "paid") {
      res.json({ status: "paid" });
      return;
    }

    // task #41: קישור שפג תוקפו — מחזיר expired כדי שהלקוח לא יוכל להתחיל תשלום
    if (sr.expires_at && new Date(String(sr.expires_at)) < new Date()) {
      res.json({ status: "expired" });
      return;
    }

    // טעינת פרטי לקוח לפרה-פיל
    let invoiceName = String(sr.invoice_name ?? "");
    let invoiceTaxId = String(sr.invoice_tax_id ?? "");
    let invoiceEmail = String(sr.invoice_email ?? "");

    if (sr.customer_id && (!invoiceName || !invoiceEmail)) {
      const { data: c } = await supabaseAdmin
        .from("customers")
        .select("name, invoice_name, email, invoice_email, tax_id")
        .eq("id", String(sr.customer_id))
        .maybeSingle();
      if (c) {
        if (!invoiceName) invoiceName = (c.invoice_name as string | null) || (c.name as string | null) || "";
        if (!invoiceTaxId) invoiceTaxId = (c.tax_id as string | null) || "";
        if (!invoiceEmail) invoiceEmail = (c.invoice_email as string | null) || (c.email as string | null) || "";
      }
    }

    // סכום + מספר הצעה
      const { data: quote } = await supabaseAdmin
        .from("quotes")
        .select("quote_number")
        .eq("id", String(sr.quote_id))
        .maybeSingle();

    let amount: number | null = null;
    if (sr.quote_version_id) {
      const { data: ver } = await supabaseAdmin
        .from("quote_versions")
        .select("totals_snapshot")
        .eq("id", String(sr.quote_version_id))
        .maybeSingle();
      const totals = (ver?.totals_snapshot ?? {}) as { total_with_vat?: number };
      amount = totals.total_with_vat != null ? Number(totals.total_with_vat) : null;
    }

    res.json({
      status: "pending",
      quote_number: quote?.quote_number ?? null,
      amount,
      invoice_name: invoiceName,
      invoice_tax_id: invoiceTaxId,
      invoice_email: invoiceEmail,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/pay/:token error");
    res.status(500).json({ error: "שגיאה בטעינת פרטי תשלום" });
  }
});

// ── POST /public/pay/:token ───────────────────────────────────────────────────
// ציבורי: מקבל פרטי חשבונית, יוצר לינק סליקה ב-Invoice4U עם IsDocCreate=true,
// שומר את הפרטים ב-signing_requests, ומחזיר { clearing_url }.
router.post("/public/pay/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params["token"]);
  const body = (req.body ?? {}) as {
    invoice_name?: string;
    invoice_tax_id?: string;
    invoice_email?: string;
  };

  const invoiceName = (body.invoice_name ?? "").trim();
  const invoiceTaxId = (body.invoice_tax_id ?? "").trim();
  const invoiceEmail = (body.invoice_email ?? "").trim();

  if (!invoiceName) {
    res.status(400).json({ error: "שם לחשבונית הוא שדה חובה" });
    return;
  }
  if (!invoiceEmail || !invoiceEmail.includes("@")) {
    res.status(400).json({ error: "יש להזין כתובת מייל תקינה" });
    return;
  }

  if (!isInvoice4UConfigured()) {
    res.status(503).json({ error: "אינטגרציית Invoice4U לא מוגדרת" });
    return;
  }

  try {
    // טעינת signing_request
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, quote_version_id, customer_id, payment_status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!sr) {
      res.status(404).json({ error: "הקישור לא נמצא" });
      return;
    }
    if (sr.payment_status === "paid") {
      res.status(409).json({ error: "התשלום כבר בוצע" });
      return;
    }
    // task #41: חסימת תשלום אם פג תוקף הקישור
    if (sr.expires_at && new Date(String(sr.expires_at)) < new Date()) {
      res.status(410).json({ error: "פג תוקף הקישור — לא ניתן לבצע תשלום" });
      return;
    }

    // טעינת סכום + מספר הצעה
    const { data: quote } = await supabaseAdmin
      .from("quotes")
      .select("quote_number")
      .eq("id", String(sr.quote_id))
      .maybeSingle();
    const quoteNumber = quote?.quote_number ?? "";

    let sum: number | null = null;
    if (sr.quote_version_id) {
      const { data: ver } = await supabaseAdmin
        .from("quote_versions")
        .select("totals_snapshot")
        .eq("id", String(sr.quote_version_id))
        .maybeSingle();
      const totals = (ver?.totals_snapshot ?? {}) as { total_with_vat?: number };
      sum = totals.total_with_vat != null ? Number(totals.total_with_vat) : null;
    }

    if (!sum || !Number.isFinite(sum) || sum <= 0) {
      res.status(400).json({ error: "לא ניתן לקבוע סכום עבור ההצעה" });
      return;
    }

    // טלפון הלקוח (אופציונלי)
    let customerPhone: string | null = null;
    if (sr.customer_id) {
      const { data: c } = await supabaseAdmin
        .from("customers")
        .select("phone")
        .eq("id", String(sr.customer_id))
        .maybeSingle();
      customerPhone = (c?.phone as string | null) ?? null;
    }

    // יצירת לינק סליקה עם IsDocCreate=true (Invoice4U יפיק חשבונית וישלח למייל)
    const returnUrl = `${publicBaseUrl(req)}/payment-done?token=${token}`;
    const result = await createPaymentLink({
      sum,
      fullName: invoiceName,
      email: invoiceEmail,
      phone: customerPhone,
      installments: 1,
      description: `תשלום עבור הצעה ${quoteNumber}`.trim(),
      externalId: quoteNumber || String(sr.quote_id),
      returnUrl,
      isDocCreate: true,
      docHeadline: `הצעה ${quoteNumber}`.trim(),
      docComments: invoiceTaxId ? `ת.ז/ח.פ: ${invoiceTaxId}` : undefined,
    });

    logger.info({ raw: result.raw, ok: result.ok }, "pay/:token — createPaymentLink response");

    if (!result.ok || !result.url) {
      res.status(502).json({ error: result.error ?? "כשל ביצירת לינק סליקה" });
      return;
    }

    // task #42: רישום PaymentId (מזהה Meshulam/upay) מתוך OpenInfo לצורך מעקב.
    // אין עמודה ייעודית ב-DB — נשמר בלוג עד שתתווסף (ראה task #47).
    if (result.paymentId) {
      logger.info(
        { paymentId: result.paymentId, clearingId: result.clearingId },
        "pay/:token — Invoice4U PaymentId from OpenInfo",
      );
    }

    // שמירת פרטי חשבונית + clearing_id (I4UClearingLogId)
    await supabaseAdmin
      .from("signing_requests")
      .update({
        invoice_name: invoiceName,
        invoice_tax_id: invoiceTaxId || null,
        invoice_email: invoiceEmail,
        ...(result.clearingId ? { clearing_id: result.clearingId } : {}),
        payment_status: "pending",
      })
      .eq("token", token);

    res.json({ clearing_url: result.url });
  } catch (err) {
    logger.error({ err }, "POST /public/pay/:token error");
    res.status(500).json({ error: "שגיאה ביצירת לינק תשלום" });
  }
});

// ── verifyAndNotifyPayment ────────────────────────────────────────────────────
// פונקציה פנימית: מאמתת תשלום מול Invoice4U ושולחת התראה חד-פעמית.
interface SigningRequestRow {
  id: string;
  quote_id: string;
  customer_id: string | null;
  clearing_id: string | null;
  payment_status: string | null;
  paid_amount: number | null;
}

interface VerifyResult {
  status: "paid" | "pending" | "no_link";
  amount?: number;
}

async function verifyAndNotifyPayment(
  sr: SigningRequestRow,
): Promise<VerifyResult> {
  // כבר שולם — אין לשלוח פעם נוספת
  if (sr.payment_status === "paid") {
    return { status: "paid", amount: Number(sr.paid_amount ?? 0) };
  }

  // clearing_id נשמר בלבד על ידי POST /public/pay/:token בצד השרת.
  // ⚠️ אסור לקבל clearing_id ממשתמש/ReturnUrl — כל בעל token יכול לשייך
  //    סליקה זרה לבקשה זו. מאמתים רק לפי מה שנשמר בשרת.
  const clearingId = sr.clearing_id;
  if (!clearingId) {
    return { status: "no_link" };
  }

  // אימות מול Invoice4U API (GetClearingLogByI4UClearingLogId)
  let amount = 0;
  let apiConfirmed = false;

  const st = await getClearingStatus(clearingId);
  if (st.isSuccess) {
    apiConfirmed = true;
    amount = st.amount;
    logger.info({ srId: sr.id, amount, confirmationNumber: st.confirmationNumber }, "getClearingStatus confirmed payment");
  } else {
    logger.info({ srId: sr.id, raw: st.raw }, "getClearingStatus returned not-success");
  }

  if (!apiConfirmed) {
    return { status: "pending" };
  }

  // עדכון atomic: מונע כפילות — רק אם payment_notified_at עדיין null
  const { data: updated } = await supabaseAdmin
    .from("signing_requests")
    .update({
      payment_status: "paid",
      paid_amount: amount,
      payment_notified_at: new Date().toISOString(),
    })
    .eq("id", sr.id)
    .is("payment_notified_at", null)
    .select("id")
    .maybeSingle();

  if (updated) {
    // אנחנו ראשונים — טוענים quote_number + customer_name ושולחים התראה
    try {
      const { data: qRow } = await supabaseAdmin
        .from("quotes")
        .select("quote_number")
        .eq("id", sr.quote_id)
        .maybeSingle();
      let customerName = "";
      if (sr.customer_id) {
        const { data: cRow } = await supabaseAdmin
          .from("customers")
          .select("name")
          .eq("id", sr.customer_id)
          .maybeSingle();
        customerName = cRow?.name ?? "";
      }
      const msg = `💰 התקבל תשלום על הצעה ${qRow?.quote_number ?? ""} — סכום ${amount}₪ של הלקוח ${customerName}`;
      const spPhone = await resolveSalespersonPhone(String(sr.quote_id));
      void sendSalespersonNotification(msg, spPhone);
      logger.info({ srId: sr.id, amount }, "payment notification sent");
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, "payment notify failed");
    }
  } else {
    logger.info({ srId: sr.id }, "payment already notified — skipping duplicate");
  }

  return { status: "paid", amount };
}

// ── POST /public/payment-return/:token ────────────────────────────────────────
// ציבורי (ללא התחברות): נקרא מדף התודה אחרי תשלום — מאמת ושולח התראה.
router.post(
  "/public/payment-return/:token",
  async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params["token"]);
  try {
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, customer_id, clearing_id, payment_status, paid_amount")
      .eq("token", token)
      .maybeSingle();

      if (!sr) {
        res.status(404).json({ error: "הקישור לא נמצא" });
        return;
      }

      // Invoice4U מפנה ל-ReturnUrl אחרי תשלום — מגיע עם returnParams מהדפדפן.
      // ⚠️ לא מקבלים clearing_id מפרמטרים אלה — כל בעל token יכול לזייף אותם.
      //    האימות נעשה אך ורק לפי clearing_id שנשמר בשרת בזמן יצירת לינק הסליקה.
      const returnParams = ((req.body as { returnParams?: Record<string, string> })?.returnParams) ?? {};
      logger.info({ returnParams }, "payment-return: returnParams from Invoice4U (for debug only)");

      const result = await verifyAndNotifyPayment(sr as SigningRequestRow);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "POST /public/payment-return/:token error");
      res.status(500).json({ error: "שגיאה באימות תשלום" });
    }
  },
);

// ── POST /quotes/:id/check-payment ───────────────────────────────────────────
// מאומת: כפתור "בדוק תשלום" ממסך ההצעה — מאמת ושולח התראה (idempotent).
router.post("/quotes/:id/check-payment", async (req: Request, res: Response): Promise<void> => {
  const quoteId = String(req.params["id"]);
  try {
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, customer_id, clearing_id, payment_status, paid_amount, created_at")
      .eq("quote_id", quoteId)
      .not("clearing_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sr) {
      res.json({ status: "no_link" });
      return;
    }

    const result = await verifyAndNotifyPayment(sr as SigningRequestRow);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /quotes/:id/check-payment error");
    res.status(500).json({ error: "שגיאה בבדיקת תשלום" });
  }
});

// ── GET /public/signing/:token ────────────────────────────────────────────────
// ציבורי (ללא התחברות): מחזיר פרטי בקשת החתימה + signed URL לצפייה ב-PDF.
router.get("/public/signing/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params["token"]);
  try {
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, customer_id, status, unsigned_pdf_path, signed_at, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!sr) {
      res.status(404).json({ error: "הקישור לא נמצא" });
      return;
    }

    let status = String(sr.status);
    if (status === "pending" && new Date(String(sr.expires_at)) < new Date()) {
      status = "expired";
    }

      const { data: quote } = await supabaseAdmin
        .from("quotes")
        .select("quote_number")
        .eq("id", String(sr.quote_id))
        .maybeSingle();

      let customerName = "";
      let customerEmail = "";
    if (sr.customer_id) {
        const { data: c } = await supabaseAdmin
          .from("customers")
          .select("name, email, invoice_email")
          .eq("id", String(sr.customer_id))
          .maybeSingle();
      customerName = c?.name ?? "";
      customerEmail = c?.invoice_email || c?.email || "";
    }

    let pdfUrl: string | null = null;
    if (sr.unsigned_pdf_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from(PDF_BUCKET)
        .createSignedUrl(String(sr.unsigned_pdf_path), 3600);
      pdfUrl = signed?.signedUrl ?? null;
    }

    res.json({
      status,
      customer_name: customerName,
      customer_email: customerEmail,
      quote_number: quote?.quote_number ?? null,
      pdf_url: pdfUrl,
      signed_at: sr.signed_at ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /public/signing/:token error");
    res.status(500).json({ error: "שגיאה בטעינת בקשת החתימה" });
  }
});

// ── POST /public/signing/:token ───────────────────────────────────────────────
// ציבורי: מתעד את החתימה (שם + ת"ז + IP + זמן), מעדכן סטטוס ההצעה ל"נחתם",
// ושולח התראת WhatsApp לאיש המכירות דרך n8n.
router.post("/public/signing/:token", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.params["token"]);
  const body = (req.body ?? {}) as { signer_name?: string; signer_id_number?: string; customer_note?: string; signer_email?: string };
  const signerName = (body.signer_name ?? "").trim();
  const signerId = (body.signer_id_number ?? "").trim();
  const customerNote = (body.customer_note ?? "").trim();
  const signerEmail = (body.signer_email ?? "").trim();

  if (!signerName) {
    res.status(400).json({ error: "יש להזין שם מלא" });
    return;
  }

  try {
    const { data: sr } = await supabaseAdmin
      .from("signing_requests")
      .select("id, quote_id, quote_version_id, customer_id, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (!sr) {
      res.status(404).json({ error: "הקישור לא נמצא" });
      return;
    }
    if (sr.status === "signed") {
      res.status(409).json({ error: "המסמך כבר נחתם" });
      return;
    }
    if (sr.status !== "pending") {
      res.status(400).json({ error: "הקישור אינו פעיל" });
      return;
    }
    if (new Date(String(sr.expires_at)) < new Date()) {
      res.status(400).json({ error: "פג תוקף הקישור" });
      return;
    }

    const fwd = String(req.headers["x-forwarded-for"] ?? "");
    const ip = fwd.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    const ua = req.headers["user-agent"] ?? null;
    const now = new Date();

    // עדכון עם משמר-מרוץ: מעדכנים רק אם עדיין pending.
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("signing_requests")
      .update({
        status: "signed",
        signer_name: signerName,
        signer_id_number: signerId || null,
        customer_note: customerNote || null,
        signed_at: now.toISOString(),
        signed_ip: ip,
        signed_user_agent: ua,
      })
      .eq("id", sr.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (upErr) {
      logger.error({ err: upErr }, "signing_requests update failed");
      res.status(500).json({ error: "שגיאה בשמירת החתימה" });
      return;
    }
    if (!updated) {
      // מישהו הקדים — כבר נחתם
      res.status(409).json({ error: "המסמך כבר נחתם" });
      return;
    }

    // עדכון סטטוס ההצעה: גרסה → approved + נעילה, טבלת quotes → "נחתמה".
    try {
      await db
        .update(quoteVersionsTable)
        .set({ status: "approved", updated_at: now, approved_at: now, locked_at: now })
        .where(eq(quoteVersionsTable.id, String(sr.quote_version_id)));
      await db
        .update(quotesTable)
        .set({ status: "נחתמה", updated_at: now })
        .where(eq(quotesTable.id, String(sr.quote_id)));
    } catch (statusErr) {
      logger.error({ err: statusErr }, "failed to set quote approved after signing");
    }

    // התראת WhatsApp לאיש המכירות + מייל ללקוח (fire-and-forget).
    try {
      const { data: quote } = await supabaseAdmin
        .from("quotes")
        .select("quote_number")
        .eq("id", String(sr.quote_id))
        .maybeSingle();

      let customerName = "";
      let customerEmail = "";
      if (sr.customer_id) {
        const { data: c } = await supabaseAdmin
          .from("customers")
          .select("name, email, invoice_email")
          .eq("id", String(sr.customer_id))
          .maybeSingle();
        customerName = c?.name ?? "";
        customerEmail = c?.invoice_email || c?.email || "";
      }
      // אם הלקוח הזין מייל בטופס החתימה — משתמשים בו (גובר על ה-DB)
      if (signerEmail) customerEmail = signerEmail;

      // WhatsApp לאיש המכירות
      const msg = [
        `✍️ הצעה ${quote?.quote_number ?? ""} נחתמה!`,
        customerName ? `לקוח: ${customerName}` : "",
        `חתם/ה: ${signerName}${signerId ? ` (ת"ז ${signerId})` : ""}`,
        customerNote ? `הודעת לקוח: ${customerNote}` : "",
        `בתאריך: ${now.toLocaleString("he-IL")}`,
      ]
        .filter(Boolean)
        .join("\n");
      const spPhone = await resolveSalespersonPhone(String(sr.quote_id));
      void sendSalespersonNotification(msg, spPhone);
      await supabaseAdmin
        .from("signing_requests")
        .update({ notified_at: now.toISOString() })
        .eq("id", sr.id);

      // מייל ללקוח עם פרטי החתימה + לינק ה-PDF
      if (customerEmail) {
        let pdfUrl: string | null = null;
        const { data: srFull } = await supabaseAdmin
          .from("signing_requests")
          .select("unsigned_pdf_path")
          .eq("id", sr.id)
          .maybeSingle();
        if (srFull?.unsigned_pdf_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from("quote-pdfs")
            .createSignedUrl(String(srFull.unsigned_pdf_path), 7 * 24 * 3600);
          pdfUrl = signed?.signedUrl ?? null;
        }
        void sendSignedEmail({
          to: customerEmail,
          customerName,
          quoteNumber: quote?.quote_number ?? "",
          signerName,
          signerId,
          signedAt: now.toLocaleString("he-IL"),
          customerNote,
          pdfUrl,
        });
      }
    } catch (notifyErr) {
      logger.error({ err: notifyErr }, "failed to send signed notification");
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "POST /public/signing/:token error");
    res.status(500).json({ error: "שגיאה בשמירת החתימה" });
  }
});

export default router;
