---
name: API client codegen barrel
description: Orval appends duplicate generated exports to the handwritten API client barrel.
---

After running API codegen, remove duplicate exports that Orval appends to the handwritten React API client barrel; keep one export each for the generated API and generated schemas.

**Why:** Repeated codegen runs append the same two exports instead of replacing them, leaving a noisy duplicate public surface even though TypeScript still passes.

**How to apply:** After every OpenAPI regeneration, inspect the non-generated client barrel and deduplicate only that file; never hand-edit files inside generated directories.