---
name: API path prefix
description: All API calls must use /api/ prefix; orval includes it, manual customFetch calls must add it explicitly.
---

The Express app mounts all routes under `/api`:
```typescript
app.use("/api", router);
```

orval-generated hooks (from the OpenAPI spec) automatically include `/api/` in their URL templates (e.g. `` `/api/leads` ``).

Manual `customFetch` calls written by hand must also include `/api/` explicitly:
- CORRECT: `customFetch('/api/quotes')`
- WRONG: `customFetch('/quotes')` — this hits the Vite dev server, not the API, and returns nothing useful

**Why:** There is no Vite proxy configured in vite.config.ts. Calls without `/api/` prefix go nowhere and cause `data.map is not a function` runtime errors when React Query sets data to a non-array value.

**How to apply:** Any time you write a `customFetch` or `fetch` call targeting the API server, always start the path with `/api/`.
