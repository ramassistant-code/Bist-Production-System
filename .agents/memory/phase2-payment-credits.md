---
name: Phase 2 payment+credits creation
description: Pattern for creating payment record and credits after deal creation in POST /deals
---

## Pattern
After `db.transaction()` returns the deal result, two separate steps run outside the transaction:
1. **Payment** (Step 9): insert into payments with `source_key = "deal_creation:{dealId}"`. Use `.onConflictDoNothing()`.
2. **Credits** (Step 10): for each item in items_snapshot, for each component in components_snapshot, insert credit with `source_key = "deal:{dealId}:item:{line_id}:component:{component_id}"`. Use `.onConflictDoNothing()`.

## payment_method mapping
- cash → מזומן
- credit_card → אשראי
- bank_transfer → העברה בנקאית

## items_snapshot structure
Array of: `{ line_id, quantity, product_id, product_name_snapshot, components_snapshot: [{ component_id, quantity, component_name_snapshot, component_description_snapshot }] }`

## Credit quantity
= item.quantity × comp.quantity (total units across the line)

## Status values
- payment.status: "התקבל" (default)
- payment.payment_purpose: "לקוח חדש"
- credit.status: "בתהליך" (not "ממתין" which is the DB default)

**Why:** Partial unique indexes on source_key (WHERE source_key IS NOT NULL AND deleted_at IS NULL) ensure idempotency. ON CONFLICT DO NOTHING works with partial indexes.
