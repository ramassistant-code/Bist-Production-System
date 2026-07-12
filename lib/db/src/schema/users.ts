import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const appUsersTable = pgTable("app_users", {
  id: uuid("id").primaryKey(),
  full_name: text("full_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  role: text("role"),
  is_active: boolean("is_active").notNull().default(true),
  monday_board_id: text("monday_board_id"),
  monday_item_id: text("monday_item_id"),
  monday_group_id: text("monday_group_id"),
  monday_raw_data: text("monday_raw_data"),
  created_at: timestamp("created_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export type AppUser = typeof appUsersTable.$inferSelect;
