---
name: Quotes module architecture
description: Snapshot-based versioning system for quotes; Supabase-locked schema; key gotchas for routes and types.
---

## Tables (Supabase-locked, no DDL)
- `quotes` — master record (customer/lead ref, status, event_date, latest_version_id)
- `quote_versions` — each version has full JSON snapshots (party, items, totals, terms, notes)
- `quote_products` — line items per version (product_id, qty, unit_price, total_price, snapshot fields)
- `quote_components` — component rows per quote_product (component_id, qty, cost, name snapshot)

## Status flow
טיוטה → נשלחה → מאושרת / נדחתה / בוטלה

## Key runtime gotchas
- `db.execute(sql\`...\`)` returns `{ rows: [...] }` — use `result.rows` for the array
- Drizzle `.set({})` requires explicit typed object for conditional updates (not `Record<string,unknown>` cast)
- `lead_created_at` is `timestamp` type — pass `new Date()` not `new Date().toISOString()`
- `useMutation` needs explicit type params when `onSuccess` data type must be narrowed

## Route pattern
All quotes routes mounted under `/api/quotes` via `quotesRouter` registered in `routes/index.ts`.
POST /api/quotes builds a full snapshot from products+components at creation time.
