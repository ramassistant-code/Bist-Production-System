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
import { dealsTable, customersTable, appUsersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

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
