---
name: refresh_deal_payment_totals
description: How refreshDealPaymentTotals works, its dual-axis comparison, and where it's called
---

## Current behaviour (updated)

Function in `artifacts/api-server/src/routes/deals.ts` (line ~96):
- Sums `amount_paid` (ex-VAT) and `amount_paid_including_vat` (inc-VAT) from non-deleted payments
- Fetches both `total_amount` (ex-VAT) and `total_amount_including_vat` from the deal
- Marks "שולמה במלואה" if EITHER axis shows fully paid (OR logic):
  - `totalExVat > 0 && paidExVat >= totalExVat - 0.01`
  - `totalIncVat > 0 && paidIncVat >= totalIncVat - 0.01`

**Why dual-axis:** Older payments may lack `amount_paid_including_vat` (field added later). Pre-VAT-migration deals may have `total_amount = 0` with only `total_amount_including_vat` populated. OR logic handles all cases.

## Where it's called
1. `POST /deals` — after deal creation with initial payment (line ~945)
2. `POST /deals/:id/payments` — after adding a payment (line ~1317)
3. `PATCH /deals/:id` — after every edit, so "עריכה מהירה" fixes stale status (added 2026-08-17)

**Why on PATCH:** The EditModal was overwriting payment_status with stale values from when the modal opened. Now PATCH always recomputes from actual payments, making payment_status read-only in the UI.

## Payment insertion rounding guard (added 2026-08-17)

Before inserting a payment, the route fetches `remaining_amount` (generated DB column = `total_amount - paid_amount`). If `amount_ex_vat > remainingExVat` by less than 0.02, it caps `amount_ex_vat` at `remainingExVat`.

**Why:** Converting inc-VAT → ex-VAT rounds up (e.g. 317.71 / 1.18 = 269.25) while DB has 269.24, triggering the `amount_paid_not_greater_than_total` DB constraint. The cap absorbs the rounding error silently.
