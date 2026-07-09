# BIST Production System

An internal production management system for BIST Productions.

Core flow: Customer → Products / Components → Quote → Quote Version Snapshot → Approved Quote → Production Order → Tasks → Activity Log

---

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only — **only when milestone requires it**)
- Required env: `SUPABASE_DB_URL` — Supabase Postgres connection string (via pooler: `aws-1-ap-south-1.pooler.supabase.com:5432`, user `postgres.<project_ref>`)
- Required env: `SUPABASE_URL` — Supabase project URL
- Required env: `SUPABASE_ANON_KEY` — Supabase anon/public key
- Required env: `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (backend only, never expose to frontend)

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Database: Supabase Postgres
- Styling: Tailwind CSS
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Source control: GitHub

Keep the project simple, stable, portable and maintainable. Do not create Replit-only architecture unless explicitly required.

---

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB schema)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/middlewares/` — Express middlewares

---

## 1. Project Scope

Build an internal production management system for BIST Productions.

Core flow:
Customer → Products / Components → Quote → Quote Version Snapshot → Approved Quote → Production Order → Tasks → Activity Log

Do not build a generic project-management tool.
Do not add features outside the approved milestone.

---

## 2. Hebrew + RTL — Critical Rules

The entire user-facing UI must be in Hebrew and full RTL.

Mandatory:
- Set root layout to `dir="rtl"` and `lang="he"`.
- All visible UI text must be Hebrew.
- Buttons, labels, menus, forms, tables, modals, toasts, validation messages, loading states, empty states, errors and statuses must be Hebrew.
- Do not leave English template text or default library text in the UI.
- UI should feel like a practical Israeli internal operations system.

Keep code in English:
- files, folders, variables, functions, types, API routes, database tables and database columns.

Allowed English in UI only for real technical values:
IDs, emails, URLs, API keys, environment variable names and developer/debug values.

Israeli formatting:
- Dates: DD/MM/YYYY
- Date + time: DD/MM/YYYY HH:mm
- Currency: ₪
- Phone numbers: Israeli format when displayed

### Fixed Hebrew UI Terms

Navigation:
- Dashboard = דשבורד
- Customers = לקוחות
- Products = מוצרים
- Components = רכיבים
- Quotes = הצעות מחיר
- Production = הפקה
- Production Orders = הזמנות הפקה
- Tasks = משימות
- Activity Log = יומן פעילות
- Settings = הגדרות

Actions:
- Create = יצירה
- Add = הוספה
- Edit = עריכה
- Save = שמירה
- Cancel = ביטול
- Delete = מחיקה
- View = צפייה
- Search = חיפוש
- Filter = סינון
- Approve = אישור
- Send = שליחה

Statuses:
- Draft = טיוטה
- Sent = נשלחה
- Approved = אושרה
- Rejected = נדחתה
- Todo = לביצוע
- In Progress = בתהליך
- Done = הושלם
- Blocked = חסום

---

## 3. Quote History Rule (Core Business Rule)

Old quotes and quote versions must NEVER change because of later product/component price changes.

When creating a quote version, save a full snapshot:
- customer details
- quote metadata
- all quote items
- quantities
- prices
- discounts/taxes if used
- totals

Product and component prices may change later, but old quote versions must remain unchanged.

---

## 4. Supabase and Secrets

- Supabase is the database source of truth.
- Never hard-code secrets.
- Use environment variables / Replit Secrets only.
- Never expose service-role keys to the frontend.
- Do not commit `.env`, API keys or secrets.
- Keep `.env.example` updated.
- **Never change the Supabase schema unless a milestone explicitly requires it.**

---

## 5. GitHub, Claude Code and CodeWords

- GitHub is the source of truth for code once connected.
- Commit every stable milestone.
- Use clear English commit messages.
- Use branches for risky or large changes.
- Do not make large uncommitted changes.

Claude Code:
- May be used later for review, debugging, refactoring and PR work.
- Must follow this file and project documentation.
- Must not add features outside the approved milestone.

CodeWords:
- May be used later for business automations and external workflows.
- Do not integrate it into the core app unless explicitly requested.
- It must not change production data or code without explicit approval.

Do not add GitHub Actions, Claude Code, CodeWords, Monday.com or other external integrations unless explicitly requested in the current milestone.

---

## 6. Development Rules

- Work in small milestones only.
- **Do not continue to the next feature without approval.**
- Do not invent business logic.
- Do not redesign unrelated areas.
- Do not change database schema unless the milestone requires it.
- Prefer small files and clear names.
- Add error/loading/empty states where relevant.
- Update documentation when behavior changes.

If the user asks for documentation only:
- Do not build UI.
- Do not install packages.
- Do not implement features.

---

## 7. Required Response After Every Milestone

After each implementation step, report:
1. What was built
2. Files changed
3. How to test it
4. Known limitations
5. Whether any visible English text remains in the UI

A milestone is not complete if Hebrew/RTL is broken or visible English UI remains.

---

## Architecture decisions

- Supabase Postgres is the database — never replaced with Replit-managed Postgres.
- Schema is locked and must not be changed without an explicit milestone request.
- All UI text is Hebrew; all code identifiers are English.

---

## Product

Internal production management system for BIST Productions. Manages the full lifecycle from customer to production order.

---

## User preferences

- All user-facing UI must be Hebrew + RTL.
- Do not implement anything without an explicit milestone request.
- Do not advance to the next feature without approval.
- Never change the Supabase schema without explicit milestone authorization.

---

## Supabase Schema (source of truth — NEVER change without explicit milestone)

Existing tables (18): `app_users`, `audit_logs`, `component_resources`, `components`, `credits`, `customers`, `deals`, `leads`, `monday_import_records`, `payments`, `product_components`, `products`, `quote_components`, `quote_products`, `quote_status_history`, `quotes`, `resources`, `special_tasks`.
Views: `v_deal_summary`, `v_quote_summary`.

Key structure:
- Quotes are versioned via `quote_version_group_id` + `version_number`; `quote_products` / `quote_components` hold full price/name snapshots (`*_snapshot`, `original_*` columns) — this implements the Quote History Rule at DB level.
- Soft deletes via `deleted_at` on most tables.
- Monday.com import lineage on most tables (`monday_board_id`, `monday_item_id`, `monday_group_id`, `monday_raw_data`).
- `deals` are created from approved quotes; `payments` and `credits` hang off deals.

**Never run `drizzle-kit push` / DDL against this database unless a milestone explicitly requires it.**

## Gotchas

- The Supabase direct DB host (`db.<ref>.supabase.co`) is IPv6-only and unreachable from Replit — always use the pooler URL (`aws-1-ap-south-1.pooler.supabase.com:5432`) in `SUPABASE_DB_URL`. The db package auto-rewrites direct-host URLs to the pooler at startup as a safety net.
- `SUPABASE_DB_URL` is a Replit Secret — never store it in `.replit` or any committed file.
- Replit's built-in `DATABASE_URL` points to Replit-managed Postgres, NOT Supabase. The db package prefers `SUPABASE_DB_URL`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
- Always snapshot quote data at creation — never reference live prices from later changes.
- Run codegen after any OpenAPI spec change before touching frontend code.
- `.env.example` must be kept up to date when new secrets are added.

---

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- Supabase schema is the source of truth — read it before building any feature.
