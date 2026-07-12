---
name: Deals module architecture
description: Key decisions, DB trigger behavior, enum values, and lead→customer resolution for the deals module.
---

# Deals Module Architecture

## DB Triggers (do NOT duplicate in app code)
- `trg_populate_deal_snapshots_from_quote_version` (BEFORE INSERT): validates status='approved' + locked_at not null, copies quote_id + 5 snapshot columns + sets snapshot_locked_at.
- `trg_protect_deal_snapshots` (BEFORE UPDATE): blocks changes to quote_id, source_quote_version_id, or 5 snapshot columns after creation.

## INSERT payload (trigger handles the rest)
```ts
{ deal_number, customer_id, source_quote_version_id, execution_status: "פתוחה", total_amount, paid_amount: "0", remaining_amount: total_amount }
```
Leave quote_id and snapshot columns out — trigger fills them.

## Hebrew Enum Values (stored directly in DB as Hebrew strings)
- execution_status: "פתוחה" / "ממתינה לתיאום" / "בטיפול" / "הושלמה" / "בוטלה"
- payment_status: "ממתינה לתשלום" / "תשלום חלקי" / "שולמה במלואה"

## Error Mapping (Postgres → Hebrew UI)
- `code === "23505"` on source_quote_version_id constraint → "כבר קיימת עסקה עבור גרסת הצעה זו"
- message includes "Deal can only be created from an approved quote version" OR "Approved quote version must be locked before creating a deal" → "לא ניתן לפתוח עסקה מהצעה שלא אושרה"
- message includes "Deal snapshots and source quote reference cannot be modified after creation" → log + generic Hebrew error

## Lead→Customer Resolution (app code, not trigger)
1. If quote.customer_id → use it directly
2. If quote.lead_id → search customers WHERE lead_id = quote.lead_id
3. Fallback: phone lookup from party_snapshot.normalized_phone/phone (last 9 digits)
4. Last resort: INSERT new customer from lead data (customer_number format: C-000001)

## PATCH (editable fields only)
Only: execution_status, payment_status, special_notes. Never touch quote_id, source_quote_version_id, or snapshot columns.

**Why:** DB trigger blocks snapshot changes and raises exception — better to not expose them in UI at all.

## deal_number format
D-{YEAR}-{6-digit-zero-padded} e.g. D-2026-001546
Generated via: `SELECT MAX(CAST(SUBSTRING(deal_number FROM '[0-9]+$') AS BIGINT)) + 1 FROM deals WHERE deal_number LIKE 'D-{year}-%'`
