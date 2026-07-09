import { defineConfig } from "drizzle-kit";
import path from "path";

// WARNING: The Supabase schema is the source of truth and must NEVER be
// changed by this project (no `drizzle-kit push`) unless a milestone
// explicitly requires it. See replit.md.
const connectionString =
  process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("SUPABASE_DB_URL must be set");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
