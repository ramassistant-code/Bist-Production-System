---
name: Codegen duplicate exports
description: orval appends to index.ts causing duplicate export errors
---

## Rule
After every `cd lib/api-spec && pnpm run codegen` run, open `lib/api-client-react/src/index.ts` and remove any duplicate `export *` lines.

**Why:** orval v8 appends its export lines without checking if they already exist. Running codegen twice results in:
```
export * from "./generated/api";   // first run
export * from "./generated/api";   // second run — duplicate, TS error
```

**How to apply:** Keep the file to exactly:
```ts
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
```
