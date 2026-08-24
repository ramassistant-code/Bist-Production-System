import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const crmAdsTable = pgTable("crm_ads", {
  id: uuid("id").primaryKey().defaultRandom(),
  facebook_ad_id: text("facebook_ad_id").notNull(),
  name: text("name"),
  ad_url: text("ad_url"),
  funnel_id: uuid("funnel_id"),
  last_synced_at: timestamp("last_synced_at", { withTimezone: true }),
  fetch_failed: boolean("fetch_failed").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CrmAd = typeof crmAdsTable.$inferSelect;
export type InsertCrmAd = typeof crmAdsTable.$inferInsert;