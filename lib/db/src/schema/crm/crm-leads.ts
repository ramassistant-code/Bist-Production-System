import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crmLeadsTable = pgTable("crm_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone_e164: text("phone_e164").notNull(),
  phone_raw: text("phone_raw"),
  email: text("email"),
  sales_rep_id: uuid("sales_rep_id"),
  status_code: text("status_code").notNull().default("new"),
  is_active_customer: boolean("is_active_customer").notNull().default(false),
  answer_status: text("answer_status"),
  capture_attempts: integer("capture_attempts").notNull().default(0),
  rejection_reason_code: text("rejection_reason_code"),
  rejection_detail: text("rejection_detail"),
  pending_reassignment: boolean("pending_reassignment").notNull().default(false),
  legacy_lead_id: uuid("legacy_lead_id"),
  linked_customer_id: uuid("linked_customer_id"),
  source: text("source").notNull().default("crm"),
  source_ref: text("source_ref"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

const USER_EDITABLE_FIELDS = {
  name: true,
  phone_e164: true,
  phone_raw: true,
  email: true,
  status_code: true,
  answer_status: true,
  rejection_reason_code: true,
  rejection_detail: true,
  pending_reassignment: true,
  source_ref: true,
} as const;

export const insertCrmLeadSchema = createInsertSchema(crmLeadsTable)
  .pick(USER_EDITABLE_FIELDS);

export const updateCrmLeadSchema = createUpdateSchema(crmLeadsTable)
  .pick(USER_EDITABLE_FIELDS)
  .partial();

export type CrmLead = typeof crmLeadsTable.$inferSelect;
export type InsertCrmLead = typeof crmLeadsTable.$inferInsert;
export type UpdateCrmLead = z.infer<typeof updateCrmLeadSchema>;