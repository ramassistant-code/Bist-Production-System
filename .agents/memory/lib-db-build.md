---
name: lib/db build requirement
description: Must rebuild lib/db after adding new schema files for api-server typecheck to see them
---

# lib/db Build Requirement

## Rule
After adding a new file to `lib/db/src/schema/`, run:
```
cd lib/db && pnpm tsc --build --force
```
This regenerates `dist/schema/*.d.ts`. Without this, api-server typecheck fails with "Module has no exported member" even if the export is in `schema/index.ts`.

**Why:** lib/db uses TypeScript project references (`composite: true`). api-server resolves types from `dist/` declaration files, not source `.ts` files directly.

**How to apply:** Any time a new schema table is added to lib/db, rebuild before running typecheck on api-server or any consumer package.
