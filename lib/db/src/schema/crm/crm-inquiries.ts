import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const crmInquiriesTable = pgTable("crm_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  lead_id: uuid("lead_id").notNull(),
  ad_id: uuid("ad_id"),
  funnel_id: uuid("funnel_id"),
  form_name: text("form_name"),
  free_text: text("free_text"),
  inquiry_at: timestamp("inquiry_at", { withTimezone: true }).notNull().defaultNow(),
  inquiry_number: integer("inquiry_number").notNull().default(1),
  raw_payload: jsonb("raw_payload").notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const USER_EDITABLE_FIELDS = {
  form_name: true,
  free_text: true,
} as const;

export const insertCrmInquirySchema = createInsertSchema(crmInquiriesTable)
  .pick(USER_EDITABLE_FIELDS);

export const updateCrmInquirySchema = createUpdateSchema(crmInquiriesTable)
  .pick(USER_EDITABLE_FIELDS)
  .partial();

export type CrmInquiry = typeof crmInquiriesTable.$inferSelect;
export type InsertCrmInquiry = typeof crmInquiriesTable.$inferInsert;
export type UpdateCrmInquiry = z.infer<typeof updateCrmInquirySchema>;