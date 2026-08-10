import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { quotesTable, quoteVersionsTable, customersTable } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { supabaseAdmin } from "../lib/supabase-admin";
import { createPaymentLink, isInvoice4UConfigured } from "../lib/invoice4u";
import { buildOnboardingMessage, buildWhatsAppLink, normalizePhoneIL } from "../lib/whatsapp-link";
import { sendWhatsAppNotification } from "../lib/invoiceWebhook";

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
// ממסך הצעת המחיר: מייצר לינק חתימה (עמוד ציבורי ל-PDF) + לינק תשלום (Invoice4U
// על הסכום כולל מע"מ מתוך totals_snapshot), ובונה הודעת WhatsApp מוכנה לעריכה.
router.post("/quotes/:id/onboarding", async (req: Request, res: Response): Promise<void> => {
  const quoteId = String(req.params["id"]);

  if (!isInvoice4UConfigured()) {
    res.status(503).json({ error: "אינטגרציית Invoice4U לא מוגדרת (חסר INVOICE4U_API_KEY)" });
    return;
  }

  try {
    // ── 1. טעינת הצעה + לקוח ─────────────────────────────────────────────────
    const rows = await db
      .select({
        quote_id: quotesTable.id,
        quote_number: quotesTable.quote_number,
        current_version_id: quotesTable.current_version_id,
        customer_id: quotesTable.customer_id,
        customer_name: customersTable.name,
        customer_phone: customersTable.phone,
        customer_email: customersTable.email,
        invoice_name: customersTable.invoice_name,
        invoice_email: customersTable.invoice_email,
      })
      .from(quotesTable)
      .leftJoin(customersTable, eq(quotesTable.customer_id, customersTable.id))
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

    // ── 2. סכום כולל מע"מ מתוך totals_snapshot של הגרסה ──────────────────────
    const verRows = await db
      .select({
        id: quoteVersionsTable.id,
        version_number: quoteVersionsTable.version_number,
        totals_snapshot: quoteVersionsTable.totals_snapshot,
      })
      .from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.id, versionId))
      .limit(1);

    if (verRows.length === 0) {
      res.status(404).json({ error: "גרסת ההצעה לא נמצאה" });
      return;
    }
    const totals = (verRows[0]!.totals_snapshot ?? {}) as { total_with_vat?: number };
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

    // ── 5. לינק תשלום (Invoice4U) על הסכום כולל מע"מ ─────────────────────────
    const fullName = quote.invoice_name || quote.customer_name || "לקוח";
    const email = quote.invoice_email || quote.customer_email || null;

    const result = await createPaymentLink({
      sum,
      fullName,
      email,
      phone: quote.customer_phone ?? null,
      installments: 1,
      description: `תשלום עבור הצעה ${quote.quote_number ?? ""}`.trim(),
      externalId: quote.quote_number ?? quoteId,
      returnUrl: RETURN_URL_BASE || null,
    });

    if (!result.ok || !result.url) {
      res.status(502).json({ error: result.error ?? "כשל ביצירת לינק תשלום" });
      return;
    }

    // ── 6. בניית ההודעה + לינק ה-WhatsApp ────────────────────────────────────
    const signingUrl = `${publicBaseUrl(req)}/sign/${token}`;
    const message = buildOnboardingMessage({
      customerName: quote.customer_name || fullName,
      signingUrl,
      paymentUrl: result.url,
    });
    const phone = normalizePhoneIL(quote.customer_phone);
    const whatsappUrl = buildWhatsAppLink(quote.customer_phone, message);

    res.json({
      signing_url: signingUrl,
      payment_url: result.url,
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
    if (sr.customer_id) {
      const { data: c } = await supabaseAdmin
        .from("customers")
        .select("name")
        .eq("id", String(sr.customer_id))
        .maybeSingle();
      customerName = c?.name ?? "";
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
  const body = (req.body ?? {}) as { signer_name?: string; signer_id_number?: string };
  const signerName = (body.signer_name ?? "").trim();
  const signerId = (body.signer_id_number ?? "").trim();

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

    // התראת WhatsApp לאיש המכירות דרך n8n (fire-and-forget, פעם אחת).
    try {
      const { data: quote } = await supabaseAdmin
        .from("quotes")
        .select("quote_number")
        .eq("id", String(sr.quote_id))
        .maybeSingle();
      let customerName = "";
      if (sr.customer_id) {
        const { data: c } = await supabaseAdmin
          .from("customers")
          .select("name")
          .eq("id", String(sr.customer_id))
          .maybeSingle();
        customerName = c?.name ?? "";
      }
      const msg = [
        `✍️ הצעה ${quote?.quote_number ?? ""} נחתמה!`,
        customerName ? `לקוח: ${customerName}` : "",
        `חתם/ה: ${signerName}${signerId ? ` (ת"ז ${signerId})` : ""}`,
        `בתאריך: ${now.toLocaleString("he-IL")}`,
      ]
        .filter(Boolean)
        .join("\n");
      void sendWhatsAppNotification(msg);
      await supabaseAdmin
        .from("signing_requests")
        .update({ notified_at: now.toISOString() })
        .eq("id", sr.id);
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
