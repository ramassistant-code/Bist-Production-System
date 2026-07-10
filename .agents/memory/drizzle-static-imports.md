---
name: Drizzle static imports
description: Always import drizzle-orm operators statically, not with dynamic import()
---

## Rule
Import all drizzle-orm operators (`and`, `or`, `ilike`, `eq`, `isNull`, `asc`, `sql`, etc.) with top-level static imports, never inside route handlers with `await import(...)`.

**Why:** Dynamic `import()` inside async route handlers worked in development but caused issues with the esbuild bundle (tree-shaking, circular deps). Static imports are safe and correct.

**How to apply:**
```ts
// CORRECT
import { isNull, asc, sql, and, or, ilike, eq } from "drizzle-orm";

// WRONG
const { and, or } = await import("drizzle-orm");
```
