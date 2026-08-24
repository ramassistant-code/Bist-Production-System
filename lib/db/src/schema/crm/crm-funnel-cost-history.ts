import { pgTable, uuid, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const crmFunnelCostHistoryTable = pgTable("crm_funnel_cost_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  funnel_id: uuid("funnel_id").notNull(),
  cost_per_lead: numeric("cost_per_lead", { precision: 12, scale: 2 }).notNull(),
  valid_from: date("valid_from").notNull().default(sql`current_date`),
  valid_to: date("valid_to"),
  updated_by: uuid("updated_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmFunnelCostHistory = typeof crmFunnelCostHistoryTable.$inferSelect;
export type InsertCrmFunnelCostHistory = typeof crmFunnelCostHistoryTable.$inferInsert;