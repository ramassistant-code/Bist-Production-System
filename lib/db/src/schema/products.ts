import { pgTable, text, uuid, numeric, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  product_number: text("product_number").notNull(),
  name: text("name").notNull(),
  category: text("category"),
  deliverable_type: text("deliverable_type"),
  consumer_price: numeric("consumer_price"),
  bulk_price: numeric("bulk_price"),
  production_cost: numeric("production_cost"),
  min_profit: numeric("min_profit"),
  product_explanation: text("product_explanation"),
  sales_notes: text("sales_notes"),
  portfolio_link: text("portfolio_link"),
  quote_description_default: text("quote_description_default"),
  quote_notes_default: text("quote_notes_default"),
  is_active: boolean("is_active").default(true),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

const PRODUCT_EDITABLE_FIELDS = {
  name: true,
  category: true,
  deliverable_type: true,
  consumer_price: true,
  product_explanation: true,
  sales_notes: true,
  quote_description_default: true,
  quote_notes_default: true,
  is_active: true,
} as const;

export const insertProductSchema = createInsertSchema(productsTable)
  .pick(PRODUCT_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם המוצר הוא שדה חובה"),
    consumer_price: z.string().nullable().optional(),
  });

export const updateProductSchema = createUpdateSchema(productsTable)
  .pick(PRODUCT_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם המוצר הוא שדה חובה").optional(),
    consumer_price: z.string().nullable().optional(),
  });

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
