import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmCallLogsTable = pgTable("crm_call_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  lead_id: uuid("lead_id"),
  user_id: uuid("user_id"),
  phone_e164: text("phone_e164"),
  direction: text("direction").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  duration_sec: integer("duration_sec").notNull().default(0),
  result: text("result").notNull(),
  recording_url: text("recording_url"),
  ai_summary: text("ai_summary"),
  voicecenter_call_id: text("voicecenter_call_id").notNull(),
  raw_payload: jsonb("raw_payload"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmCallLog = typeof crmCallLogsTable.$inferSelect;
export type InsertCrmCallLog = typeof crmCallLogsTable.$inferInsert;