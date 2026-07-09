---
name: Supabase connection quirks
description: How this project connects to Supabase Postgres from Replit and why the direct host fails
---

# Supabase connection quirks

- The direct host `db.<project_ref>.supabase.co:5432` is **IPv6-only**; Replit has no IPv6 route, so psql/pg fail with an empty connection error.
- **Why:** Supabase moved direct DB hosts to IPv6; IPv4 access goes through the Supavisor pooler.
- **How to apply:** Always connect via the pooler: host `aws-1-ap-south-1.pooler.supabase.com`, port 5432 (session mode), username `postgres.<project_ref>` (project ref appended to user, not host). Note the `aws-1` prefix — `aws-0-ap-south-1` returns "tenant/user not found" for this project.
- The connection string lives in the `SUPABASE_DB_URL` **Replit Secret** (never in `.replit` — it was moved out because `.replit` is committed to git). Replit's `DATABASE_URL` is runtime-managed and points at Replit's own Postgres — it cannot be overwritten and must not be used for Supabase.
- Users tend to paste the direct-host URL from the Supabase dashboard; the db layer auto-rewrites direct hosts to the pooler at startup, so a direct URL in the secret still works. Region override: `SUPABASE_POOLER_REGION`.
- The old DB password was exposed in git history (`.replit` in early commits) and in chat — rotation in the Supabase dashboard is strongly advised before making the repo public.
- Schema can also be introspected without Postgres access via the PostgREST OpenAPI endpoint: `GET $SUPABASE_URL/rest/v1/` with the service-role key (`definitions` contains all tables/columns).

# BIST project rule

- The Supabase schema is pre-existing and locked: never run DDL / `drizzle-kit push` against it unless a milestone explicitly authorizes it.
