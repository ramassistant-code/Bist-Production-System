#!/usr/bin/env node
/**
 * One-time seed script: sets (or resets) the Supabase Auth password for the
 * very first app_users account so someone can log in before any admin UI
 * is usable.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/seed-first-user.mjs <email> <password>
 *
 * Example (from workspace root):
 *   node scripts/seed-first-user.mjs admin@bist.local MySecurePass123
 *
 * Requirements:
 *   - The email must already exist as an active row in the app_users table.
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars must be set.
 *   - Password must be at least 8 characters.
 *   - Run this ONCE to bootstrap. After that, use the Settings UI.
 *
 * NOTE: Once role-based permissions are implemented, the "set initial password"
 * UI action (Settings > Users) must be restricted to admin role only.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required."
  );
  process.exit(1);
}

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/seed-first-user.mjs <email> <password>");
  process.exit(1);
}

if (password.length < 8) {
  console.error("ERROR: Password must be at least 8 characters.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`Setting password for: ${email}`);

  const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    console.error("ERROR listing auth users:", listErr.message);
    process.exit(1);
  }

  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    console.log(`Auth user found (${existing.id}). Updating password...`);
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
    });
    if (error) {
      console.error("ERROR updating password:", error.message);
      process.exit(1);
    }
    console.log("Password updated successfully.");
  } else {
    console.log("No existing auth user. Creating new auth user...");
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error("ERROR creating auth user:", error.message);
      process.exit(1);
    }
    console.log(`Auth user created (${data.user?.id}).`);
  }

  console.log(`Done! You can now log in as ${email}.`);
}

main();
