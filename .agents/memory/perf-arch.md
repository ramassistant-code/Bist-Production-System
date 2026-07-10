---
name: Performance architecture
description: How dashboard KPIs and leads data are loaded efficiently
---

## Rule
Dashboard must never fetch raw lead/customer rows. Always use `/api/stats` which returns SQL aggregations only.

**Why:** The leads table has 2,800+ rows. Fetching them all just for KPI counts caused 880ms+ load times and large payloads. A single aggregation query takes ~50ms.

**How to apply:** Dashboard uses `useGetDashboardStats` hook (generated from GET /api/stats). Any new dashboard KPI must be added to the SQL in `artifacts/api-server/src/routes/stats.ts`.

## Leads
Leads page uses server-side filtering (`search`, `status`, `limit`, `offset` query params). Default limit=300. Debounce search input 400ms before sending. Pagination via page state × limit offset.

## Compression
`compression` middleware is installed in `artifacts/api-server` and applied before routes in `app.ts`. This gives ~5–8× payload reduction on JSON responses.
