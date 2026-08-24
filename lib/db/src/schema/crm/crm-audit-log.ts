import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const crmAuditLogTable = pgTable("crm_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity_type: text("entity_type").notNull(),
  entity_id: uuid("entity_id"),
  action: text("action").notNull(),
  actor_user_id: uuid("actor_user_id"),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmAuditLog = typeof crmAuditLogTable.$inferSelect;
export type InsertCrmAuditLog = typeof crmAuditLogTable.$inferInsert;