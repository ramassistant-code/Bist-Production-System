---
name: refresh_deal_payment_totals migration
description: What was changed in refresh_deal_payment_totals DB function
---

## Migration applied 2026-07-13
Function now:
1. Updates `amount_paid_including_vat = v_paid` (was missing before)
2. Uses `COALESCE(total_amount_including_vat, total_amount)` for v_total comparison (was `total_amount` only)

**Why:** deals.amount_paid_including_vat was not being updated by the trigger, so GET /deals/:id showed stale value. The total comparison also needed the VAT-inclusive total.
