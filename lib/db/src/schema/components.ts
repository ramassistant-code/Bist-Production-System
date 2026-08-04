import { pgTable, text, uuid, numeric, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const componentsTable = pgTable("components", {
  id: uuid("id").primaryKey().defaultRandom(),
  component_number: text("component_number").notNull(),
  name: text("name").notNull(),
  deliverable: text("deliverable"),
  sop_link: text("sop_link"),
  category: text("category"),
  coordination_owner: text("coordination_owner"),
  internal_notes: text("internal_notes"),
  quote_description_default: text("quote_description_default"),
  quote_notes_default: text("quote_notes_default"),
  cost: numeric("cost"),
  default_price: numeric("default_price"),
  is_active: boolean("is_active").default(true),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: jsonb("monday_raw_data"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

const COMPONENT_EDITABLE_FIELDS = {
  name: true,
  quote_description_default: true,
  quote_notes_default: true,
  is_active: true,
} as const;

export const insertComponentSchema = createInsertSchema(componentsTable)
  .pick(COMPONENT_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם הרכיב הוא שדה חובה"),
  });

export const updateComponentSchema = createUpdateSchema(componentsTable)
  .pick(COMPONENT_EDITABLE_FIELDS)
  .extend({
    name: z.string().min(1, "שם הרכיב הוא שדה חובה").optional(),
  });

export type Component = typeof componentsTable.$inferSelect;
export type InsertComponent = z.infer<typeof insertComponentSchema>;
export type UpdateComponent = z.infer<typeof updateComponentSchema>;
