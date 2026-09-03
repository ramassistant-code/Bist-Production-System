import { pgTable, text, uuid, date, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  customer_number: text("customer_number").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  joined_at: date("joined_at"),
  birthday: date("birthday"),
  account_manager_id: uuid("account_manager_id"),
  invoice_name: text("invoice_name"),
  tax_id: text("tax_id"),
  invoice_email: text("invoice_email"),
  customer_type: text("customer_type"),
  industry: text("industry"),
  pain_points: text("pain_points"),
  lead_id: uuid("lead_id"),
  ltv_amount: numeric("ltv_amount"),
  pipeline_amount_ex_vat: numeric("pipeline_amount_ex_vat"),
  account_manager_contact_status: text("account_manager_contact_status"),
  account_manager_contact_date: date("account_manager_contact_date"),
  // The FIRST salesperson who closed this customer (app_users.id). Stamped once
  // when the customer's first deal is opened and never overwritten; the deal
  // itself keeps its own salesperson_id. Mirrored to Monday's "איש מכירות ראשון".
  first_salesperson_id: uuid("first_salesperson_id"),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

const USER_EDITABLE_FIELDS = {
  name: true,
  phone: true,
  email: true,
  joined_at: true,
  birthday: true,
  invoice_name: true,
  tax_id: true,
  invoice_email: true,
  customer_type: true,
  industry: true,
  pain_points: true,
  first_salesperson_id: true,
} as const;

export const insertCustomerSchema = createInsertSchema(customersTable)
  .pick(USER_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם הלקוח הוא שדה חובה"),
    email: z.string().email("כתובת אימייל אינה תקינה").nullable().optional(),
    first_salesperson_id: z.uuid("יש לבחור איש מכירות מהרשימה").nullable().optional(),
  });

export const updateCustomerSchema = createUpdateSchema(customersTable)
  .pick(USER_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם הלקוח הוא שדה חובה").optional(),
    email: z.email("כתובת אימייל אינה תקינה").nullable().optional(),
    first_salesperson_id: z.uuid("יש לבחור איש מכירות מהרשימה").nullable().optional(),
  });

export type Customer = typeof customersTable.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
