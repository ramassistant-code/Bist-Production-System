import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  payment_number: text("payment_number").notNull().default(sql`make_business_number('P'::text, 'payment_number_seq'::text, true)`),
  deal_id: uuid("deal_id").notNull(),
  customer_id: uuid("customer_id"),
  salesperson_id: uuid("salesperson_id"),
  status: text("status").notNull().default("התקבל"),
  payment_date: text("payment_date"),
  payment_method: text("payment_method"),
  payment_purpose: text("payment_purpose"),
  amount_paid: numeric("amount_paid").notNull().default("0"),
  installments_count: integer("installments_count"),
  commission_percent: numeric("commission_percent"),
  commission_amount: numeric("commission_amount"),
  net_amount: numeric("net_amount"),
  studio_hours_amount: numeric("studio_hours_amount"),
  editing_amount: numeric("editing_amount"),
  creative_amount: numeric("creative_amount"),
  strategy_meetings_count: integer("strategy_meetings_count"),
  booking_system_cleared: boolean("booking_system_cleared"),
  cashflow_link: text("cashflow_link"),
  invoice_name: text("invoice_name"),
  invoice_tax_id: text("invoice_tax_id"),
  invoice_email: text("invoice_email"),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  source_type: text("source_type"),
  source_key: text("source_key"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export type Payment = typeof paymentsTable.$inferSelect;
export type NewPayment = typeof paymentsTable.$inferInsert;
