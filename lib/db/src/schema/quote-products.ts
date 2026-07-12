import { pgTable, uuid, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const quoteProductsTable = pgTable("quote_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_id: uuid("quote_id").notNull(),
  source_product_id: uuid("source_product_id"),
  product_name_snapshot: text("product_name_snapshot"),
  category_snapshot: text("category_snapshot"),
  deliverable_type_snapshot: text("deliverable_type_snapshot"),
  description_snapshot: text("description_snapshot"),
  original_quantity: numeric("original_quantity"),
  original_unit_price: numeric("original_unit_price"),
  quantity: numeric("quantity"),
  unit_price: numeric("unit_price"),
  total_price: numeric("total_price"),
  quantity_change_reason: text("quantity_change_reason"),
  price_override_reason: text("price_override_reason"),
  customer_note: text("customer_note"),
  internal_note: text("internal_note"),
  sort_order: integer("sort_order"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteProduct = typeof quoteProductsTable.$inferSelect;
