import type { Request } from "express";
import { eq, sql, type SQL } from "drizzle-orm";
import { crmLeadsTable } from "@workspace/db/schema";

export type CrmLeadView = "rep" | "manager";

export function crmLeadView(value: unknown): CrmLeadView {
  return value === "manager" ? "manager" : "rep";
}

/**
 * The single visibility policy for CRM lead rows.
 * All CRM lead list and detail queries must compose this condition.
 */
export function leadScope(req: Request, viewMode: CrmLeadView): SQL {
  const appUser = req.appUser;
  if (!appUser) return sql`false`;

  if (appUser.role === "sales") {
    return eq(crmLeadsTable.sales_rep_id, appUser.id);
  }

  if (appUser.role === "admin" || appUser.role === "sales_manager") {
    return viewMode === "manager"
      ? sql`true`
      : eq(crmLeadsTable.sales_rep_id, appUser.id);
  }

  return sql`false`;
}