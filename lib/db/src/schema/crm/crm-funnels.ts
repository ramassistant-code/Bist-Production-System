import { pgTable, uuid, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const crmFunnelsTable = pgTable("crm_funnels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  current_cost_per_lead: numeric("current_cost_per_lead", { precision: 12, scale: 2 }),
  cost_updated_at: timestamp("cost_updated_at", { withTimezone: true }),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmFunnel = typeof crmFunnelsTable.$inferSelect;
export type InsertCrmFunnel = typeof crmFunnelsTable.$inferInsert;