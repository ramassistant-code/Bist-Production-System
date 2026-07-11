# BIST Production System

[![CI](https://github.com/ramassistant-code/Bist-Production-System/actions/workflows/ci.yml/badge.svg)](https://github.com/ramassistant-code/Bist-Production-System/actions/workflows/ci.yml)

Internal production management system for BIST Productions (מערכת הפקות BIST).
The entire user-facing UI is in Hebrew with full RTL support.

Core flow: Customer → Products / Components → Quote → Quote Version Snapshot → Approved Quote → Production Order → Tasks → Activity Log

## Stack

- **Monorepo**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React + Vite + Tailwind CSS (Hebrew RTL, `lang="he" dir="rtl"`)
- **Backend**: Node.js + Express
- **Database**: Supabase Postgres (source of truth, pre-existing schema)
- **API contract**: OpenAPI spec (`lib/api-spec/openapi.yaml`) with Orval codegen (React Query hooks + Zod schemas)
- **ORM**: Drizzle

## Project structure

```
artifacts/bist-app/      React + Vite frontend (Hebrew RTL app shell)
artifacts/api-server/    Express API server
lib/api-spec/            OpenAPI spec — source of truth for API contracts
lib/api-client-react/    Generated React Query hooks (do not edit by hand)
lib/api-zod/             Generated Zod schemas (do not edit by hand)
lib/db/                  Drizzle ORM setup + schema
```

## How to run locally

Prerequisites: Node.js 24+, pnpm 9+.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables
cp .env.example .env
# then fill in real values (see below)

# 3. Run the frontend (Vite dev server)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/bist-app run dev

# 4. Run the API server (in a second terminal)
PORT=8080 pnpm --filter @workspace/api-server run dev
```

Useful commands:

```bash
pnpm run typecheck                                # typecheck all packages
pnpm --filter @workspace/api-spec run codegen     # regenerate API hooks/schemas after spec changes
```

## Required environment variables

See `.env.example` for the full list with placeholder values. Never commit real values.

| Variable | Purpose |
|---|---|
| `SUPABASE_DB_URL` | Supabase Postgres connection string. Must use the Supavisor pooler host (`aws-1-<region>.pooler.supabase.com:5432`) — the direct `db.<ref>.supabase.co` host is IPv6-only. |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key (safe for frontend) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — **backend only, never expose to the frontend** |
| `PORT` | Port for each dev server (set automatically on Replit) |

## Health checks

With the API server running on port 8080:

```bash
# Server health — expect {"status":"ok"}
curl http://localhost:8080/api/health

# Database connectivity — expect {"status":"ok","database":"connected"}
curl http://localhost:8080/api/db-check
```

`/api/db-check` returns HTTP 500 with `{"error":"database connection failed"}` if the Supabase database is unreachable (check `SUPABASE_DB_URL`).

## Project rules

See `replit.md` for the full set of rules. Highlights:

- All user-facing UI text is Hebrew, full RTL. Code identifiers stay in English.
- The Supabase schema is pre-existing and **locked** — never run DDL or `drizzle-kit push` without an explicit milestone authorizing it.
- Quote versions are immutable snapshots — old quote versions must never change when product/component prices change.
- Israeli formatting: dates DD/MM/YYYY, currency ₪.
- Never commit `.env`, API keys, or any secrets.
