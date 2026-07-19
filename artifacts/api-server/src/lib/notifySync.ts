import { logger } from "./logger";

const SYNC_WEBHOOK_URL = "https://runtime.codewords.ai/run/monday_inbound_polling_d35bc976/webhook/supabase";
const CODEWORDS_API_KEY = process.env.CODEWORDS_API_KEY ?? "";

export function notifySync(entity_type: "customer" | "lead" | "deal", record_id: string): void {
  if (!CODEWORDS_API_KEY) {
    logger.warn({ entity_type, record_id }, "notifySync: CODEWORDS_API_KEY is not set, skipping");
    return;
  }
  fetch(SYNC_WEBHOOK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CODEWORDS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entity_type, record_id }),
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    logger.warn({ err, entity_type, record_id }, "notifySync: webhook call failed (fire-and-forget)");
  });
}
