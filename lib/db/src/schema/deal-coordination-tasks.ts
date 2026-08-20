import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const dealCoordinationTasksTable = pgTable("deal_coordination_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  deal_id: uuid("deal_id").notNull(),
  task_text: text("task_text").notNull(),
  assignee_role: text("assignee_role").notNull(),
  status: text("status").default("open"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
});

export type DealCoordinationTask = typeof dealCoordinationTasksTable.$inferSelect;
