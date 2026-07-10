# Memory Index

- [Supabase connection quirks](supabase-connection.md) — direct DB host is IPv6-only/unreachable from Replit; use aws-1-ap-south-1 pooler with postgres.<ref> user; schema is locked, no DDL without milestone.
- [Drizzle eq() params cast](drizzle-params-cast.md) — Express req.params typed as string|string[]; must use String(req.params.x) in drizzle eq() calls or typecheck fails.
- [orval queryKey required](orval-querykey.md) — orval-generated useGetX hooks require explicit queryKey in query options object.
- [sanitize cast pattern](sanitize-cast.md) — sanitize() returns Record<string,unknown>; cast to generated API body type via "as unknown as TargetType" to satisfy TS2352.
- [Products/Components schema mapping](products-schema-mapping.md) — Actual Supabase column names differ from user spec; key mappings documented.
