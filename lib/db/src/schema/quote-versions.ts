import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const quoteVersionsTable = pgTable("quote_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_id: uuid("quote_id").notNull(),
  version_number: integer("version_number").notNull(),
  status: text("status").default("draft"),
  party_snapshot: jsonb("party_snapshot"),
  items_snapshot: jsonb("items_snapshot"),
  totals_snapshot: jsonb("totals_snapshot"),
  terms_snapshot: jsonb("terms_snapshot"),
  notes_snapshot: jsonb("notes_snapshot"),
  created_by: text("created_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  rejected_at: timestamp("rejected_at", { withTimezone: true }),
  cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
  locked_at: timestamp("locked_at", { withTimezone: true }),
});

export type QuoteVersion = typeof quoteVersionsTable.$inferSelect;
