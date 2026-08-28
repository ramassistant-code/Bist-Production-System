import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  dealsTable,
  paymentsTable,
  productsTable,
  type Deal,
} from "@workspace/db/schema";

export const PAID_STATUSES = ["שולמה במלואה", "שולם"] as const;

export function isDealPaid(deal: Pick<Deal, "payment_status">): boolean {
  return PAID_STATUSES.some((status) => status === deal.payment_status);
}

export async function paymentsForDeal(dealId: string) {
  return db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.deal_id, dealId), isNull(paymentsTable.deleted_at)))
    .orderBy(desc(paymentsTable.created_at));
}

type PaymentRow = Awaited<ReturnType<typeof paymentsForDeal>>[number];

export async function dealsForCustomer(customerId: string) {
  const deals = await db
    .select()
    .from(dealsTable)
    .where(and(eq(dealsTable.customer_id, customerId), isNull(dealsTable.deleted_at)))
    .orderBy(desc(dealsTable.created_at));

  const paymentRows = new Map<string, PaymentRow[]>();
  if (deals.length > 0) {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          inArray(
            paymentsTable.deal_id,
            deals.map((deal) => deal.id),
          ),
          isNull(paymentsTable.deleted_at),
        ),
      )
      .orderBy(desc(paymentsTable.created_at));

    for (const payment of payments) {
      const dealPayments = paymentRows.get(payment.deal_id) ?? [];
      dealPayments.push(payment);
      paymentRows.set(payment.deal_id, dealPayments);
    }
  }

  return deals.map((deal) => ({
    ...deal,
    payments: paymentRows.get(deal.id) ?? [],
    amounts_trustworthy:
      !(deal.monday_item_id && (paymentRows.get(deal.id)?.length ?? 0) === 0),
  }));
}

function productIdsFromItemsSnapshot(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return [];

  return snapshot.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = (item as Record<string, unknown>)["product_id"];
    return typeof value === "string" ? [value] : [];
  });
}

export async function productsForCustomer(customerId: string) {
  const customerDeals = await db
    .select({ items_snapshot: dealsTable.items_snapshot })
    .from(dealsTable)
    .where(and(eq(dealsTable.customer_id, customerId), isNull(dealsTable.deleted_at)));

  const productIds = [
    ...new Set(customerDeals.flatMap((deal) => productIdsFromItemsSnapshot(deal.items_snapshot))),
  ];
  if (productIds.length === 0) return [];

  return db
    .select()
    .from(productsTable)
    .where(and(inArray(productsTable.id, productIds), isNull(productsTable.deleted_at)));
}