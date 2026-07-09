import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DB_URL must be set to the Supabase Postgres connection string.",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
