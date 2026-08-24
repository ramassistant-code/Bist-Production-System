import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crmLeadNotesTable = pgTable("crm_lead_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  lead_id: uuid("lead_id").notNull(),
  user_id: uuid("user_id"),
  content: text("content").notNull(),
  edited_at: timestamp("edited_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const USER_EDITABLE_FIELDS = {
  content: true,
} as const;

export const insertCrmLeadNoteSchema = createInsertSchema(crmLeadNotesTable)
  .pick(USER_EDITABLE_FIELDS);

export const updateCrmLeadNoteSchema = createUpdateSchema(crmLeadNotesTable)
  .pick(USER_EDITABLE_FIELDS)
  .partial();

export type CrmLeadNote = typeof crmLeadNotesTable.$inferSelect;
export type InsertCrmLeadNote = typeof crmLeadNotesTable.$inferInsert;
export type UpdateCrmLeadNote = z.infer<typeof updateCrmLeadNoteSchema>;