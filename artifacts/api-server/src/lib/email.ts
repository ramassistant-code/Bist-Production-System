// ── Email sending helper ──────────────────────────────────────────────────────
// שולח מייל עם PDF ופרטי חתימה לאחר חתימת הלקוח.
// מחייב הגדרת SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
// אם לא מוגדר — מדפיס אזהרה בלבד.

import nodemailer from "nodemailer";
import { logger } from "./logger";

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER;

function isSmtpConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * שולח קוד כניסה חד-פעמי למשתמש מערכת.
 */
export async function sendLoginCodeEmail(to: string, code: string): Promise<boolean> {
  if (!isSmtpConfigured()) {
    logger.warn({ to }, "email: SMTP not configured — cannot send login code");
    return false;
  }
  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;direction:rtl;color:#111827;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#111827;">קוד כניסה למערכת BIST</h2>
  <p>הקוד שלך לכניסה למערכת:</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">${code}</div>
  <p style="color:#6b7280;">הקוד תקף ל-10 דקות. אם לא ביקשת קוד — התעלם ממייל זה.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
  <p style="font-size:12px;color:#9ca3af;">BIST Productions</p>
</body>
</html>`;
  try {
    const transport = createTransport();
    await transport.sendMail({
      from: SMTP_FROM,
      to,
      subject: "קוד כניסה למערכת BIST",
      html,
    });
    logger.info({ to }, "login code email sent");
    return true;
  } catch (err) {
    logger.error({ err, to }, "failed to send login code email");
    return false;
  }
}

export interface SignedEmailParams {
  to: string;
  customerName: string;
  quoteNumber: string;
  signerName: string;
  signerId: string;
  signedAt: string;
  customerNote: string;
  pdfUrl: string | null;
}

/**
 * שולח מייל ללקוח לאחר חתימה על ההצעה.
 * מכיל: פרטי החותם, הודעת לקוח, לינק ל-PDF.
 */
export async function sendSignedEmail(params: SignedEmailParams): Promise<void> {
  if (!isSmtpConfigured()) {
    logger.warn(
      { to: params.to },
      "email: SMTP not configured — skipping sign confirmation email (set SMTP_HOST, SMTP_USER, SMTP_PASS)"
    );
    return;
  }

  const subject = `הצעת מחיר ${params.quoteNumber} — אישור חתימה`;

  const noteHtml = params.customerNote
    ? `<p><strong>הודעה:</strong><br/>${params.customerNote.replace(/\n/g, "<br/>")}</p>`
    : "";

  const pdfHtml = params.pdfUrl
    ? `<p><a href="${params.pdfUrl}" style="color:#2563eb;">לחץ כאן לצפייה ב-PDF של ההצעה</a></p>`
    : "";

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;direction:rtl;color:#111827;max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#111827;">✅ הצעת מחיר ${params.quoteNumber} — נחתמה בהצלחה</h2>
  <p>שלום ${params.customerName},</p>
  <p>ההצעה נחתמה. להלן פרטי החתימה:</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280;width:40%;">שם החותם</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${params.signerName}</td></tr>
    ${params.signerId ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280;">ת"ז / ח"פ</td><td style="padding:8px;border:1px solid #e5e7eb;">${params.signerId}</td></tr>` : ""}
    <tr><td style="padding:8px;border:1px solid #e5e7eb;color:#6b7280;">תאריך ושעה</td><td style="padding:8px;border:1px solid #e5e7eb;">${params.signedAt}</td></tr>
  </table>
  ${noteHtml}
  ${pdfHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
  <p style="font-size:12px;color:#9ca3af;">BIST Productions</p>
</body>
</html>`;

  try {
    const transport = createTransport();
    await transport.sendMail({
      from: SMTP_FROM,
      to: params.to,
      subject,
      html,
    });
    logger.info({ to: params.to, quoteNumber: params.quoteNumber }, "sign confirmation email sent");
  } catch (err) {
    logger.error({ err, to: params.to }, "failed to send sign confirmation email");
  }
}
