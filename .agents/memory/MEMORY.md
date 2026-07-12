# Memory Index

- [Supabase connection quirks](supabase-connection.md) — direct DB host is IPv6-only/unreachable from Replit; use aws-1-ap-south-1 pooler with postgres.<ref> user; schema is locked, no DDL without milestone.
- [Drizzle eq() params cast](drizzle-params-cast.md) — Express req.params typed as string|string[]; must use String(req.params.x) in drizzle eq() calls or typecheck fails.
- [orval queryKey required](orval-querykey.md) — orval-generated useGetX hooks require explicit queryKey in query options object.
- [sanitize cast pattern](sanitize-cast.md) — sanitize() returns Record<string,unknown>; cast to generated API body type via "as unknown as TargetType" to satisfy TS2352.
- [Products/Components schema mapping](products-schema-mapping.md) — Actual Supabase column names differ from user spec; key mappings documented.
- [Performance architecture](perf-arch.md) — dashboard uses /api/stats (SQL agg, not raw rows), leads uses server-side search/filter + pagination, gzip on all endpoints.
- [Codegen duplicate exports](codegen-duplicates.md) — orval appends exports to index.ts; after every codegen run, check lib/api-client-react/src/index.ts for duplicate export lines and remove them.
- [Drizzle static imports](drizzle-static-imports.md) — always import drizzle-orm operators (and, or, ilike, eq) statically; dynamic import() inside route handlers causes build/runtime issues.
- [API path prefix](api-path-prefix.md) — all customFetch calls need `/api/` prefix; orval-generated hooks include it automatically, manual calls must add it explicitly.
- [Quotes module architecture](quotes-module.md) — snapshot-based versioning; schema is Supabase-locked (no DDL); key type and runtime gotchas for quotes routes.
