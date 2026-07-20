import { pgTable, text, uuid, numeric, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadsTable = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  lead_number: text("lead_number").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  phone_link: text("phone_link"),
  email: text("email"),
  salesperson_id: uuid("salesperson_id"),
  status: text("status"),
  answer_status: text("answer_status"),
  capture_attempt_status: text("capture_attempt_status"),
  lead_source: text("lead_source"),
  lead_source_relation_id: uuid("lead_source_relation_id"),
  ad_name: text("ad_name"),
  referral_name: text("referral_name"),
  activity_field: text("activity_field"),
  followup_at: timestamp("followup_at", { withTimezone: true }),
  followup_note: text("followup_note"),
  reminder_at: timestamp("reminder_at", { withTimezone: true }),
  reminder_note: text("reminder_note"),
  rejection_reason: text("rejection_reason"),
  rejection_reason_text: text("rejection_reason_text"),
  lead_created_at: timestamp("lead_created_at", { withTimezone: true }),
  closed_at: timestamp("closed_at", { withTimezone: true }),
  first_deal_amount: numeric("first_deal_amount"),
  lead_count: integer("lead_count"),
  linked_customer_id: uuid("linked_customer_id"),
  task_text: text("task_text"),
  task_due_at: timestamp("task_due_at", { withTimezone: true }),
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
  status: true,
  answer_status: true,
  capture_attempt_status: true,
  lead_source: true,
  activity_field: true,
  followup_at: true,
  followup_note: true,
  reminder_at: true,
  reminder_note: true,
  rejection_reason: true,
  rejection_reason_text: true,
  first_deal_amount: true,
  task_text: true,
  task_due_at: true,
  // FK + extra fields editable from the UI
  salesperson_id: true,
  linked_customer_id: true,
  referral_name: true,
  ad_name: true,
  lead_created_at: true,
  closed_at: true,
} as const;

export const insertLeadSchema = createInsertSchema(leadsTable)
  .pick(USER_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1),
    email: z.string().email().or(z.literal("")).nullable().optional(),
  });

export const updateLeadSchema = createUpdateSchema(leadsTable)
  .pick(USER_EDITABLE_FIELDS)
  .extend({
    email: z.string().email().or(z.literal("")).nullable().optional(),
  })
  .partial();

export type Lead = typeof leadsTable.$inferSelect;
export type InsertLead = typeof leadsTable.$inferInsert;
