# Quote follow-up — SQL (BIS-10)

SQL is the source of truth for these tables, same as `sql/crm/`.
Run `01_quote_followup.sql` in the Supabase SQL Editor (dev first).
Do **not** run `drizzle-kit push`. Do **not** alter `quote_status`.

| File | What it creates |
|---|---|
| `00_test_parents.sql` | Test-only stubs for `quotes`, `quote_versions`, `customers`, `leads`, `app_users`, and `quote_status`. **Not for production.** |
| `01_quote_followup.sql` | Follow-up tables, partial unique indexes, seeds, and the `quote_activity` no-delete trigger |

Verified parent tables in this repo (FKs added): `quotes`, `quote_versions`, `customers`, `leads`, `app_users`.

Not referenced (no DDL in `lib/db`, or unused): `quote_documents`, `signing_requests`, `quote_status_history`. Feature history is `quote_activity`.

## Tests

```sh
# Local Postgres: peer auth to database bist_followup_test (created by the test runner docs).
createdb bist_followup_test   # once
cd lib/db && pnpm test
```

Override the URL with `TEST_DATABASE_URL` when not using the local Unix socket.
