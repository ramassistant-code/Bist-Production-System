/**
 * invoiceWebhook.ts
 * Sends a WhatsApp invoice-details notification to n8n via webhook.
 * Fire-and-forget: failures are logged but never propagate to the caller.
 *
 * Env vars:
 *   INVOICE_NOTIFY_ENABLED   – set to "false" to disable (default: true)
 *   INVOICE_WEBHOOK_URL      – target n8n webhook URL
 */

import { db } from "@workspace/db";
import { dealsTable, customersTable, appUsersTable, leadsTable, quotesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { normalizePhoneIL } from "./whatsapp-link";

const DEFAULT_WEBHOOK_URL =
  "https://rambist.app.n8n.cloud/webhook/invoice-details/development";

const PAYMENT_METHOD_HE: Record<string, string> = {
  cash: "מזומן",
  bank_transfer: "העברה בנקאית",
};

interface InvoiceWebhookParams {
  dealId: string;
  customerId: string | null;
  salespersonUserId: string | null;
  paymentType: string;
  invoiceName: string | null;
  invoiceIdNumber: string | null;
  invoiceEmail: string | null;
  amountPaidIncVat: number;
}

/** Build the Hebrew WhatsApp message from deal + lookup data. */
async function buildMessage(params: InvoiceWebhookParams): Promise<string> {
  // ── Fetch deal (total + items_snapshot) ────────────────────────────────────
  const dealRows = await db
    .select({
      total_amount_including_vat: dealsTable.total_amount_including_vat,
      items_snapshot: dealsTable.items_snapshot,
    })
    .from(dealsTable)
    .where(eq(dealsTable.id, params.dealId))
    .limit(1);

  const deal = dealRows[0];
  const totalIncVat = Number(deal?.total_amount_including_vat ?? 0);

  // ── Fetch customer name + phone ────────────────────────────────────────────
  let customerName = "";
  let customerPhone = "";
  if (params.customerId) {
    const custRows = await db
      .select({ name: customersTable.name, phone: customersTable.phone })
      .from(customersTable)
      .where(eq(customersTable.id, params.customerId))
      .limit(1);
    customerName = custRows[0]?.name ?? "";
    customerPhone = custRows[0]?.phone ?? "";
  }

  // ── Fetch salesperson full name ────────────────────────────────────────────
  let salespersonName = "";
  if (params.salespersonUserId) {
    const userRows = await db
      .select({ full_name: appUsersTable.full_name })
      .from(appUsersTable)
      .where(eq(appUsersTable.id, params.salespersonUserId))
      .limit(1);
    salespersonName = userRows[0]?.full_name ?? "";
  }

  // ── Build products list from items_snapshot ────────────────────────────────
  interface SnapshotItem {
    quantity?: number;
    product_name_snapshot?: string;
  }
  const items = (deal?.items_snapshot ?? []) as SnapshotItem[];
  const productLines = items
    .map((item) => `- ${item.product_name_snapshot ?? "מוצר"} × ${item.quantity ?? 1}`)
    .join("\n");

  const paymentMethodHe = PAYMENT_METHOD_HE[params.paymentType] ?? params.paymentType;

  const fmt = (n: number) =>
    n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return [
    `${customerName} שילם ₪${fmt(params.amountPaidIncVat)} מתוך ₪${fmt(totalIncVat)}`,
    "",
    "פרטים לחשבונית:",
    `שם על החשבונית: ${params.invoiceName ?? ""}`,
    `ת.ז / ח.פ: ${params.invoiceIdNumber ?? ""}`,
    `מייל לשליחת חשבונית: ${params.invoiceEmail ?? ""}`,
    "",
    "טלפון:",
    customerPhone,
    "",
    "מוצרים שנקנו:",
    productLines,
    "",
    `איש מכירות: ${salespersonName}`,
    `שולם באמצעות ${paymentMethodHe}`,
  ].join("\n");
}

/**
 * resolveSalespersonPhone — מאתר את הטלפון של איש המכירות של ההצעה.
 * quote → lead → salesperson, fallback → עסקה מההצעה, fallback → ליד הלקוח.
 * מחזיר מספר מנורמל (972...) או null.
 */
export async function resolveSalespersonPhone(quoteId: string): Promise<string | null> {
  try {
    let salespersonId: string | null = null;

    // 1) דרך הליד של ההצעה
    const qRows = await db
      .select({ lead_id: quotesTable.lead_id, customer_id: quotesTable.customer_id })
      .from(quotesTable)
      .where(eq(quotesTable.id, quoteId))
      .limit(1);
    const q = qRows[0];

    if (q?.lead_id) {
      const l = await db
        .select({ salesperson_id: leadsTable.salesperson_id })
        .from(leadsTable)
        .where(eq(leadsTable.id, q.lead_id))
        .limit(1);
      salespersonId = l[0]?.salesperson_id ?? null;
    }

    // 2) fallback — העסקה שנוצרה מההצעה
    if (!salespersonId) {
      const d = await db
        .select({ salesperson_id: dealsTable.salesperson_id })
        .from(dealsTable)
        .where(eq(dealsTable.quote_id, quoteId))
        .limit(1);
      salespersonId = d[0]?.salesperson_id ?? null;
    }

    // 3) fallback — הליד של הלקוח
    if (!salespersonId && q?.customer_id) {
      const c = await db
        .select({ lead_id: customersTable.lead_id })
        .from(customersTable)
        .where(eq(customersTable.id, q.customer_id))
        .limit(1);
      const custLeadId = c[0]?.lead_id ?? null;
      if (custLeadId) {
        const l2 = await db
          .select({ salesperson_id: leadsTable.salesperson_id })
          .from(leadsTable)
          .where(eq(leadsTable.id, custLeadId))
          .limit(1);
        salespersonId = l2[0]?.salesperson_id ?? null;
      }
    }

    if (!salespersonId) {
      logger.warn({ quoteId }, "resolveSalespersonPhone: no salesperson found for quote");
      return null;
    }

    const u = await db
      .select({ phone: appUsersTable.phone })
      .from(appUsersTable)
      .where(eq(appUsersTable.id, salespersonId))
      .limit(1);

    const phone = normalizePhoneIL(u[0]?.phone ?? null);
    if (!phone) logger.warn({ quoteId, salespersonId }, "resolveSalespersonPhone: salesperson has no usable phone");
    return phone;
  } catch (err) {
    logger.error({ err, quoteId }, "resolveSalespersonPhone failed");
    return null;
  }
}

/**
 * sendSalespersonNotification — התראת WhatsApp לאיש מכירות ספציפי,
 * דרך ה-workflow הייעודי ב-n8n (payload { message, phone }).
 * fire-and-forget, לעולם לא זורק.
 * אם phone הוא null — לא שולח כלל (מונע fallback לקבוצה בצד n8n).
 */
export async function sendSalespersonNotification(
  message: string,
  phone: string | null,
): Promise<void> {
  if (process.env.INVOICE_NOTIFY_ENABLED === "false") return;

  const webhookUrl = process.env.SALESPERSON_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.error("SALESPERSON_NOTIFY_WEBHOOK_URL is not set — salesperson notification skipped");
    return;
  }
  if (!phone) {
    logger.error("salesperson notification skipped — no phone resolved");
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, phone }),
        signal: controller.signal,
      });
      const responseBody = await res.text().catch(() => "");
      logger.info({ status: res.status, responseBody }, "salesperson notification sent");
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    logger.error({ err }, "salesperson notification failed");
  }
}

/**
 * sendWhatsAppNotification — generic fire-and-forget WhatsApp notification via
 * the same n8n webhook (payload { message }). Never throws. Used e.g. when a
 * quote is signed, so it reuses the proven INVOICE_WEBHOOK_URL / kill-switch.
 */
export async function sendWhatsAppNotification(message: string): Promise<void> {
  if (process.env.INVOICE_NOTIFY_ENABLED === "false") return;
  const webhookUrl = process.env.INVOICE_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      const responseBody = await res.text().catch(() => "");
      logger.info({ status: res.status, responseBody }, "whatsapp notification sent");
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    logger.error({ err }, "whatsapp notification failed");
  }
}

/**
 * sendInvoiceWebhook — fire-and-forget.
 * Call with `void sendInvoiceWebhook(...)` — never awaited by callers.
 */
export async function sendInvoiceWebhook(params: InvoiceWebhookParams): Promise<void> {
  // ── Kill switch ────────────────────────────────────────────────────────────
  if (process.env.INVOICE_NOTIFY_ENABLED === "false") return;

  // ── Only for cash / bank_transfer ──────────────────────────────────────────
  if (!["cash", "bank_transfer"].includes(params.paymentType)) return;

  const webhookUrl = process.env.INVOICE_WEBHOOK_URL ?? DEFAULT_WEBHOOK_URL;

  try {
    const message = await buildMessage(params);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      const responseBody = await res.text().catch(() => "");
      logger.info(
        { dealId: params.dealId, status: res.status, responseBody },
        "invoice webhook sent",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    // Never propagate — deal creation must not fail because of this
    logger.error({ err, dealId: params.dealId }, "invoice webhook failed");
  }
}
