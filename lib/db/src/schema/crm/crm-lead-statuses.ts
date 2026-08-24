import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const crmLeadStatusesTable = pgTable("crm_lead_statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  sort_order: integer("sort_order").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  is_system: boolean("is_system").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmLeadStatus = typeof crmLeadStatusesTable.$inferSelect;
export type InsertCrmLeadStatus = typeof crmLeadStatusesTable.$inferInsert;