---
name: party_snapshot customer resolution
description: How to resolve customer_id from party_snapshot in POST /deals
---

## Resolution order (Step 4 of POST /deals)
`snapCustomerId` is derived as:
1. `snap["customer_id"]` (direct)
2. `snap["source_id"]` when `snap["party_type"] === "customer"`  ← this is what the app populates
3. `quote.customer_id` (fallback from parent quote)
4. null → falls through to Case B (lead) or Case C (phone lookup)

**Why:** The party_snapshot builder stores the customer UUID in "source_id" when party_type is "customer", not in a field named "customer_id". The legacy format doesn't have a "customer_id" key.
