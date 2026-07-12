import { pgTable, uuid, text, numeric, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const quoteComponentsTable = pgTable("quote_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_product_id: uuid("quote_product_id").notNull(),
  source_component_id: uuid("source_component_id"),
  component_name_snapshot: text("component_name_snapshot"),
  description_snapshot: text("description_snapshot"),
  deliverable_snapshot: text("deliverable_snapshot"),
  original_quantity: numeric("original_quantity"),
  original_unit_price: numeric("original_unit_price"),
  quantity: numeric("quantity"),
  unit_price: numeric("unit_price"),
  total_price: numeric("total_price"),
  include_in_quote_total: boolean("include_in_quote_total"),
  quantity_change_reason: text("quantity_change_reason"),
  price_override_reason: text("price_override_reason"),
  customer_note: text("customer_note"),
  internal_note: text("internal_note"),
  sort_order: integer("sort_order"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteComponent = typeof quoteComponentsTable.$inferSelect;
