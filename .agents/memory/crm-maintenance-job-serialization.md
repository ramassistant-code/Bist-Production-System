---
name: CRM maintenance-job serialization
description: Concurrency rule for destructive CRM backfill and rewrite jobs.
---

CRM maintenance jobs that rewrite existing rows must serialize competing calls for the same logical scope and lock selected rows before deriving updates or audit details.

**Why:** A transaction alone does not prevent two concurrent calls from reading the same old value. Without serialization, both can write and create duplicate audits with stale “before” values.

**How to apply:** For form-scoped jobs, acquire a transaction-scoped advisory lock keyed by the form before selecting, and select the target rows with row locks. Keep the update and its audit insert in that transaction.