---
name: Monday sync architecture
description: How deals/payments/credits/etc sync to Monday and why sync can silently do nothing
---

# Monday sync architecture

- Outbound sync goes through an external engine (Railway, `SYNC_SERVICE_URL` + `SYNC_API_KEY` secret, `SYNC_ENV=production` adds `confirmProduction:true`). API server calls `notifySync()` fire-and-forget; missing key = **silent skip** (console.warn only).
- **Why:** sync must never break user operations, so all failures are swallowed — "nothing appears in Monday" is usually config, not a crash.
- **How to apply:** when Monday sync "doesn't work", check in order: (1) `SYNC_API_KEY` secret exists, (2) per-board `outbound_enabled` in Supabase table `monday_export_targets` (was false for deal/payments/credits/coordination_tasks until 2026-08-10; enabled after user approval), (3) push manually to `${SYNC_SERVICE_URL}/api/push` with `x-api-key` to see per-entity results ("skipped: outbound disabled" etc.).
- Board IDs and field mappings live in Supabase tables (`monday_export_targets`, `monday_export_field_mappings`), not env vars. Only enable outbound for targets that have active outbound mappings.
