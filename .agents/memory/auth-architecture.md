---
name: Auth architecture
description: How Supabase Auth + app_users login gate is implemented in BIST
---

# Auth Architecture

## Pattern
Frontend uses `@supabase/supabase-js` (installed in bist-app). Auth flow:
1. `supabase.auth.signInWithPassword({ email, password })`
2. On success, call `GET /api/auth/me` with `Authorization: Bearer <access_token>`
3. Backend verifies JWT via `supabaseAdmin.auth.getUser(token)` and queries `app_users` for active row
4. Returns user or 403 → frontend signs out and shows error

## VITE_ env vars
`SUPABASE_URL` and `SUPABASE_ANON_KEY` (server secrets) are injected into the browser bundle via `define` in `vite.config.ts`. No separate VITE_ secrets needed.

## Key files
- `artifacts/bist-app/src/lib/supabase.ts` — browser client
- `artifacts/bist-app/src/lib/auth-context.tsx` — AuthProvider + useAuth
- `artifacts/bist-app/src/pages/login.tsx` — login page
- `artifacts/api-server/src/lib/supabase-admin.ts` — admin client (SERVICE_ROLE_KEY)
- `artifacts/api-server/src/routes/users.ts` — /auth/me, /users, /admin/users/:id/set-password
- `scripts/seed-first-user.mjs` — one-time bootstrap script

## First user seed
```
node scripts/seed-first-user.mjs <email> <password>
```
Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env. Creates or updates Supabase Auth password for an existing app_users email.

## Admin set-password
POST /api/admin/users/:id/set-password — requires active Bearer JWT. Uses listUsers → createUser/updateUserById via admin API. Never logs plaintext password.

**Why:** Role enforcement is a future milestone. For now, any active app_users login can set passwords. Once roles are enforced, restrict to admin role only.
