import { pgTable, uuid, boolean, integer, timestamp, date } from "drizzle-orm/pg-core";

export const crmRepAvailabilityTable = pgTable("crm_rep_availability", {
  user_id: uuid("user_id").primaryKey(),
  is_active_today: boolean("is_active_today").notNull().default(false),
  queue_position: integer("queue_position").notNull().default(0),
  last_assigned_at: timestamp("last_assigned_at", { withTimezone: true }),
  leads_today: integer("leads_today").notNull().default(0),
  leads_today_date: date("leads_today_date"),
  updated_by: uuid("updated_by"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmRepAvailability = typeof crmRepAvailabilityTable.$inferSelect;
export type InsertCrmRepAvailability = typeof crmRepAvailabilityTable.$inferInsert;