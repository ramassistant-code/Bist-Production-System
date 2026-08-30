import { logger } from "./logger";

export type CrmNotification = {
  message: string;
  phone: string | null;
};

/**
 * CRM notifications are deliberately best-effort. Intake and bulk assignment
 * must commit even when n8n is unavailable or the receiving user has no phone.
 */
export async function sendCrmNotification({
  message,
  phone,
}: CrmNotification): Promise<void> {
  if (process.env.CRM_NOTIFY_ENABLED === "false") return;

  const webhookUrl = process.env.CRM_NOTIFY_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    logger.warn("CRM_NOTIFY_WEBHOOK_URL is not set — CRM notification skipped");
    return;
  }
  if (!phone?.trim()) {
    logger.warn("CRM notification skipped — receiving user has no phone");
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, phone }),
        signal: controller.signal,
      });
      const responseBody = await response.text().catch(() => "");
      if (!response.ok) {
        logger.warn(
          { status: response.status, responseBody },
          "CRM notification webhook returned an error",
        );
        return;
      }
      logger.info({ status: response.status }, "CRM notification sent");
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    logger.error({ err }, "CRM notification failed");
  }
}
