import { pgTable, text, uuid, numeric, timestamp, integer } from "drizzle-orm/pg-core";

export const quotesTable = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_number: text("quote_number").notNull(),
  customer_id: uuid("customer_id"),
  lead_id: uuid("lead_id"),
  current_version_id: uuid("current_version_id"),
  discount_amount: numeric("discount_amount"),
  customer_notes: text("customer_notes"),
  operation_notes: text("operation_notes"),
  internal_notes: text("internal_notes"),
  status: text("status").default("draft"),
  // legacy versioning columns — do not use in new logic
  quote_version_group_id: uuid("quote_version_group_id"),
  version_number: integer("version_number"),
  created_from_quote_id: uuid("created_from_quote_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export type Quote = typeof quotesTable.$inferSelect;
