import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  // crm | manual | monday | facebook_lead_ads
  source: text("source").notNull().default("crm"),
  // מזהה הפנייה במערכת המקור. ל-facebook_lead_ads זהו leadgen_id.
  // unique חלקי על הזוג (source, source_ref) — ראו 10_crm_inquiries_source_ref.sql
  source_ref: text("source_ref"),
  // מלא = המשפך נקבע ידנית. כל מילוי רטרואקטיבי חייב לדלג על שורות כאלה,
  // אחרת תיקון של מנהל נמחק בשקט. ראו 13_crm_inquiries_funnel_lock.sql
  // ig | fb | msg כפי שמטא מדווחת. תכונה של ההשארה ולא של האדם —
  // אותו ליד יכול להשאיר פרטים פעם באינסטגרם ופעם בפייסבוק.
  platform: text("platform"),
  is_organic: boolean("is_organic"),
  funnel_locked_at: timestamp("funnel_locked_at", { withTimezone: true }),
  funnel_locked_by: uuid("funnel_locked_by"),
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