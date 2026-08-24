import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crmLeadTasksTable = pgTable("crm_lead_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  lead_id: uuid("lead_id").notNull(),
  assigned_user_id: uuid("assigned_user_id"),
  title: text("title").notNull(),
  description: text("description"),
  due_at: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"),
  source: text("source").notNull().default("manual"),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  snoozed_until: timestamp("snoozed_until", { withTimezone: true }),
  whatsapp_sent_at: timestamp("whatsapp_sent_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const USER_EDITABLE_FIELDS = {
  title: true,
  description: true,
  due_at: true,
  status: true,
  source: true,
  snoozed_until: true,
} as const;

export const insertCrmLeadTaskSchema = createInsertSchema(crmLeadTasksTable)
  .pick(USER_EDITABLE_FIELDS);

export const updateCrmLeadTaskSchema = createUpdateSchema(crmLeadTasksTable)
  .pick(USER_EDITABLE_FIELDS)
  .partial();

export type CrmLeadTask = typeof crmLeadTasksTable.$inferSelect;
export type InsertCrmLeadTask = typeof crmLeadTasksTable.$inferInsert;
export type UpdateCrmLeadTask = z.infer<typeof updateCrmLeadTaskSchema>;