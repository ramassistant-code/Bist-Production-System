---
name: Drizzle eq() with Express req.params
description: Express req.params properties are typed as string|string[] which drizzle eq() rejects; must cast explicitly.
---

## Rule
Always wrap Express route params in `String()` before passing to drizzle `eq()`:
```ts
eq(table.column, String(req.params.id))
eq(table.column, String(req.params.pc_id))
```

**Why:** TypeScript types `req.params` as `ParamsDictionary` with index signature `[key: string]: string | string[]`. Drizzle's `eq()` overloads only accept `string | SQLWrapper`, not `string[]`, so the spread type fails overload resolution.

**How to apply:** Any time you write `eq(col, req.params.something)` in an Express+Drizzle route, add `String()` wrapping. Alternatively, destructure at the top of the handler: `const id: string = req.params.id;`
