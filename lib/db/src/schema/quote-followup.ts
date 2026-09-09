import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  time,
  jsonb,
} from "drizzle-orm/pg-core";

export const quoteFollowupSequencesTable = pgTable("quote_followup_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_id: uuid("quote_id").notNull(),
  quote_version_id: uuid("quote_version_id").notNull(),
  phone_e164: text("phone_e164").notNull(),
  provider_chat_id: text("provider_chat_id"),
  state: text("state").notNull().default("awaiting_delivered"),
  opening_sent_at: timestamp("opening_sent_at", { withTimezone: true }),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  stopped_reason: text("stopped_reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteFollowupStepsTable = pgTable("quote_followup_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence_id: uuid("sequence_id").notNull(),
  step_kind: text("step_kind").notNull(),
  state: text("state").notNull().default("pending"),
  scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  sent_text: text("sent_text"),
  provider_message_id: text("provider_message_id"),
  chat_id: text("chat_id"),
  recipient_id: text("recipient_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteFollowupInboundEventsTable = pgTable("quote_followup_inbound_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider_message_id: text("provider_message_id").notNull(),
  status: text("status").notNull(),
  recipient_id: text("recipient_id"),
  chat_id: text("chat_id"),
  from_id: text("from_id"),
  text_body: text("text_body"),
  event_at: timestamp("event_at", { withTimezone: true }),
  quoted_id: text("quoted_id"),
  sequence_id: uuid("sequence_id"),
  step_id: uuid("step_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteFollowupSettingsTable = pgTable("quote_followup_settings", {
  id: smallint("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  window_start: time("window_start").notNull(),
  window_end: time("window_end").notNull(),
  business_days: text("business_days").array().notNull(),
  followup_1_offset_days: integer("followup_1_offset_days").notNull().default(2),
  followup_2_offset_days: integer("followup_2_offset_days").notNull().default(5),
  followup_3_offset_days: integer("followup_3_offset_days").notNull().default(10),
  template_opening: text("template_opening").notNull(),
  template_followup_1: text("template_followup_1").notNull(),
  template_followup_2: text("template_followup_2").notNull(),
  template_followup_3: text("template_followup_3").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteCancelReasonsTable = pgTable("quote_cancel_reasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  requires_detail: boolean("requires_detail").notNull().default(false),
  sort_order: integer("sort_order").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  is_system: boolean("is_system").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const communicationBlocksTable = pgTable("communication_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone_e164: text("phone_e164").notNull(),
  provider_chat_id: text("provider_chat_id"),
  lid: text("lid"),
  customer_id: uuid("customer_id"),
  lead_id: uuid("lead_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removed_at: timestamp("removed_at", { withTimezone: true }),
});

export const quoteActivityTable = pgTable("quote_activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote_id: uuid("quote_id").notNull(),
  quote_version_id: uuid("quote_version_id"),
  sequence_id: uuid("sequence_id"),
  event_kind: text("event_kind").notNull(),
  actor_type: text("actor_type").notNull(),
  actor_user_id: uuid("actor_user_id"),
  payload: jsonb("payload").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuoteFollowupSequence = typeof quoteFollowupSequencesTable.$inferSelect;
export type QuoteFollowupStep = typeof quoteFollowupStepsTable.$inferSelect;
export type QuoteFollowupInboundEvent = typeof quoteFollowupInboundEventsTable.$inferSelect;
export type QuoteFollowupSettings = typeof quoteFollowupSettingsTable.$inferSelect;
export type QuoteCancelReason = typeof quoteCancelReasonsTable.$inferSelect;
export type CommunicationBlock = typeof communicationBlocksTable.$inferSelect;
export type QuoteActivity = typeof quoteActivityTable.$inferSelect;
