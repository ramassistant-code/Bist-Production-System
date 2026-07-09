import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const rawConnectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error(
    "SUPABASE_DB_URL must be set to the Supabase Postgres connection string.",
  );
}

/**
 * Supabase direct DB hosts (db.<ref>.supabase.co) are IPv6-only and
 * unreachable from environments without an IPv6 route. Rewrite such URLs
 * to the IPv4-compatible Supavisor pooler (session mode, port 5432).
 */
function normalizeSupabaseUrl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const directMatch = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    if (!directMatch) {
      return connectionString;
    }
    const projectRef = directMatch[1];
    const poolerRegion = process.env.SUPABASE_POOLER_REGION || "ap-south-1";
    url.hostname = `aws-1-${poolerRegion}.pooler.supabase.com`;
    url.port = "5432";
    url.username = `postgres.${projectRef}`;
    return url.toString();
  } catch {
    return connectionString;
  }
}

const connectionString = normalizeSupabaseUrl(rawConnectionString);

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
