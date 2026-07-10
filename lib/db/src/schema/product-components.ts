import { pgTable, text, uuid, numeric, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productComponentsTable = pgTable("product_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  product_id: uuid("product_id").notNull(),
  component_id: uuid("component_id").notNull(),
  default_quantity: numeric("default_quantity").default("1"),
  default_unit_price: numeric("default_unit_price").default("0"),
  include_in_quote_total_default: boolean("include_in_quote_total_default").default(false),
  sort_order: integer("sort_order"),
  component_cost: numeric("component_cost"),
  total_cost: numeric("total_cost"),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export const addProductComponentSchema = z.object({
  component_id: z.string().min(1, "יש לבחור רכיב"),
  default_quantity: z.string().optional(),
  default_unit_price: z.string().optional(),
});

export const updateProductComponentSchema = z.object({
  default_quantity: z.string().optional(),
  default_unit_price: z.string().optional(),
});

export type ProductComponent = typeof productComponentsTable.$inferSelect;
export type AddProductComponent = z.infer<typeof addProductComponentSchema>;
export type UpdateProductComponent = z.infer<typeof updateProductComponentSchema>;
