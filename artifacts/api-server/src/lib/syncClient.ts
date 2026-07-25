const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "";
const SYNC_KEY = process.env.SYNC_API_KEY ?? "";
const SYNC_ENV = process.env.SYNC_ENV ?? "test";

type SyncPayload =
  | { action: "customer_upserted"; id: string }
  | { action: "lead_upserted"; id: string }
  | { action: "salesperson_upserted"; id: string }
  | { action: "deal_created" | "deal_updated"; id: string; customerId?: string; leadId?: string };

/** Notify the sync service. Never throws — a sync hiccup must not break the user's op. */
export async function notifySync(payload: SyncPayload): Promise<void> {
  if (!SYNC_URL || !SYNC_KEY) {
    console.warn("[sync] SYNC_SERVICE_URL or SYNC_API_KEY not set, skipping", payload.action, payload.id);
    return;
  }
  try {
    const res = await fetch(`${SYNC_URL}/api/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": SYNC_KEY },
      body: JSON.stringify({ env: SYNC_ENV, ...payload }),
    });
    if (!res.ok) {
      console.error("[sync] failed", payload.action, payload.id, res.status, await res.text());
    } else {
      console.log("[sync] ok", payload.action, payload.id);
    }
  } catch (err) {
    console.error("[sync] error", payload.action, payload.id, err);
  }
}
