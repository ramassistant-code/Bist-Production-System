import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const creditsTable = pgTable("credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  credit_number: text("credit_number").notNull().default(sql`make_business_number('CR'::text, 'credit_number_seq'::text, true)`),
  deal_id: uuid("deal_id").notNull(),
  customer_id: uuid("customer_id"),
  source_component_id: uuid("source_component_id"),
  source_quote_item_id: text("source_quote_item_id"),
  source_quote_component_id: text("source_quote_component_id"),
  source_product_id: uuid("source_product_id"),
  parent_product_name: text("parent_product_name"),
  credit_name: text("credit_name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("ממתין"),
  owner_role: text("owner_role"),
  quantity: numeric("quantity").notNull().default("1"),
  completed_quantity: numeric("completed_quantity").notNull().default("0"),
  remaining_quantity: numeric("remaining_quantity"),
  previous_quantity: numeric("previous_quantity"),
  editing_task_link: text("editing_task_link"),
  package_notes: text("package_notes"),
  what_is_included: text("what_is_included"),
  salesperson_note: text("salesperson_note"),
  credit_date: text("credit_date"),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  source_key: text("source_key"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export type Credit = typeof creditsTable.$inferSelect;
export type NewCredit = typeof creditsTable.$inferInsert;
