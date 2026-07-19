---
name: customFetch auth pattern
description: How web app auth tokens reach API routes; what breaks when they don't
---

# customFetch Auth Pattern

## The Rule
`customFetch` in web apps does NOT send an Authorization header by default — it only sends browser cookies. To make it send a Bearer token, call `setAuthTokenGetter` once at module load time.

**Correct setup** (in `auth-context.tsx`):
```ts
import { setAuthTokenGetter } from "@workspace/api-client-react";
setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
```

This makes every `customFetch` call across the entire app attach `Authorization: Bearer <token>`.

**Why:** API routes that call `getAuthenticatedUser(req)` read from `req.headers.authorization`. Without `setAuthTokenGetter`, the header is absent and every protected route returns 401. This was the root cause of the salesperson dropdown being blank in the deal creation modal.

**How to apply:** If any route returns 401 unexpectedly from the web app, check two things:
1. Is `setAuthTokenGetter` registered? (it's in `auth-context.tsx`)
2. Is the route using `getAuthenticatedUser` which requires Bearer? If yes, the fix is on the client side, NOT removing auth from the route.

## Secret Storage
`CODWORDS_API_KEY` must be stored as a Replit Secret, NOT in `[userenv.shared]` in `.replit` (which is committed to git). Use `deleteEnvVars` + `requestEnvVar` to migrate.
