---
name: sanitize() return type cast pattern
description: sanitize() helper returns Record<string,unknown>; direct cast to generated API body type triggers TS2352. Use double-cast.
---

## Rule
```ts
// WRONG — triggers TS2352 "neither type sufficiently overlaps"
{ data: sanitize(values) as CreateProductBody }

// CORRECT — double-cast through unknown
{ data: sanitize(values) as unknown as CreateProductBody }
// or using Parameters<> utility:
{ data: sanitize(values) as unknown as Parameters<typeof mutation.mutate>[0]["data"] }
```

**Why:** `Record<string, unknown>` has no guaranteed overlap with the specific generated type, so TypeScript rejects the direct cast.

**How to apply:** Any time a form sanitize/transform helper returns a generic object type that you need to pass to a typed mutation, use `as unknown as TargetType`.
