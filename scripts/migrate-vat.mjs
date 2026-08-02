/**
 * One-time migration: switch deals & payments to store ex-VAT amounts.
 * Run with:  node scripts/migrate-vat.mjs
 */
import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();

try {
  console.log("Step 1: Add amount_paid_including_vat column (idempotent)...");
  await client.query(`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS amount_paid_including_vat numeric NOT NULL DEFAULT 0;
  `);
  console.log("  ✓ Column ready");

  console.log("Step 2: Back-fill payments — set inclusive column, then convert amount_paid to ex-VAT...");
  // Only touch rows where amount_paid_including_vat is still 0 (not yet migrated)
  const pRes = await client.query(`
    UPDATE payments p
    SET
      amount_paid_including_vat = p.amount_paid,
      amount_paid = ROUND(
        p.amount_paid / (1 + COALESCE(
          (d.totals_snapshot->>'vat_rate')::numeric,
          18
        ) / 100),
        2
      )
    FROM deals d
    WHERE p.deal_id = d.id
      AND p.deleted_at IS NULL
      AND p.amount_paid_including_vat = 0
  `);
  console.log(`  ✓ Updated ${pRes.rowCount} payment(s)`);

  console.log("Step 3: Recompute deal totals from new payment amounts...");
  const dRes = await client.query(`
    UPDATE deals d
    SET
      total_amount = COALESCE(
        (totals_snapshot->>'subtotal_after_discount')::numeric,
        ROUND(
          d.total_amount_including_vat / (1 + COALESCE((totals_snapshot->>'vat_rate')::numeric, 18) / 100),
          2
        )
      ),
      paid_amount = COALESCE((
        SELECT ROUND(SUM(amount_paid)::numeric, 2)
        FROM payments p
        WHERE p.deal_id = d.id AND p.deleted_at IS NULL
      ), 0),
      amount_paid_including_vat = COALESCE((
        SELECT ROUND(SUM(amount_paid_including_vat)::numeric, 2)
        FROM payments p
        WHERE p.deal_id = d.id AND p.deleted_at IS NULL
      ), 0),
      updated_at = NOW()
    WHERE d.deleted_at IS NULL
  `);
  console.log(`  ✓ Updated ${dRes.rowCount} deal(s)`);

  console.log("Step 4: Recompute remaining_amount and payment_status...");
  await client.query(`
    UPDATE deals
    SET
      remaining_amount = GREATEST(0, ROUND((total_amount - paid_amount)::numeric, 2)),
      payment_status = CASE
        WHEN paid_amount <= 0 THEN 'ממתינה לתשלום'
        WHEN ROUND((total_amount - paid_amount)::numeric, 2) <= 0.01 THEN 'שולמה במלואה'
        ELSE 'תשלום חלקי'
      END
    WHERE deleted_at IS NULL
  `);
  console.log("  ✓ Remaining + status updated");

  console.log("\n✅ Migration complete.");
} finally {
  await client.end();
}
