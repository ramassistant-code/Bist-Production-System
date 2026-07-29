const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "";
const SYNC_KEY = process.env.SYNC_API_KEY ?? "";
const SYNC_ENV = process.env.SYNC_ENV ?? "test";

type SyncPayload =
  | { action: "customer_upserted"; id: string }
  | { action: "lead_upserted"; id: string }
  | { action: "salesperson_upserted"; id: string }
  | { action: "deal_created" | "deal_updated"; id: string; customerId?: string; leadId?: string }
  // ── מוצרים / רכיבים / רכיבים-במוצר (צורה גנרית) ──
  | { entity: "product"; id: string }             // טבלת products
  | { entity: "component_operation"; id: string } // טבלת components
  | { entity: "deal_product"; id: string };       // טבלת product_components

/** Notify the sync service. Never throws — a sync hiccup must not break the user's op. */
export async function notifySync(payload: SyncPayload): Promise<void> {
  if (!SYNC_URL || !SYNC_KEY) {
    console.warn("[sync] SYNC_SERVICE_URL or SYNC_API_KEY not set, skipping",
      "action" in payload ? payload.action : `entity:${payload.entity}`, payload.id);
    return;
  }
  try {
    const body: Record<string, unknown> = { env: SYNC_ENV, ...payload };
    // כתיבות לייצור דורשות אישור מפורש (המנוע מחזיר 428 בלעדיו)
    if (SYNC_ENV === "production") body.confirmProduction = true;

    const res = await fetch(`${SYNC_URL}/api/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": SYNC_KEY },
      body: JSON.stringify(body),
    });
    const label = "action" in payload ? payload.action : `entity:${payload.entity}`;
    if (!res.ok) {
      console.error("[sync] failed", label, payload.id, res.status, await res.text());
    } else {
      console.log("[sync] ok", label, payload.id);
    }
  } catch (err) {
    const label = "action" in payload ? payload.action : `entity:${(payload as { entity: string }).entity}`;
    console.error("[sync] error", label, payload.id, err);
  }
}
