/**
 * One-time migration: switch deals & payments to store ex-VAT amounts.
 *
 * Run with:
 *   SUPABASE_DB_URL=... tsx scripts/migrate-vat.ts
 *
 * Safe to re-run: column creation is idempotent; data updates use COALESCE
 * so already-migrated rows with amount_paid_including_vat != 0 are skipped.
 */

import postgres from "postgres";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL must be set");

const sql = postgres(connectionString, { ssl: "require" });

async function run() {
  console.log("Step 1: Add amount_paid_including_vat column (if missing)...");
  await sql`
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS amount_paid_including_vat numeric NOT NULL DEFAULT 0;
  `;
  console.log("  ✓ Column ready");

  console.log("Step 2: Back-fill payments — copy current (inclusive) amount_paid to amount_paid_including_vat, then convert amount_paid to ex-VAT...");
  const { count: pCount } = await sql`
    UPDATE payments p
    SET
      amount_paid_including_vat = CASE WHEN amount_paid_including_vat = 0 THEN p.amount_paid ELSE amount_paid_including_vat END,
      amount_paid = CASE WHEN amount_paid_including_vat = 0
        THEN ROUND(
          p.amount_paid / (1 + COALESCE(
            (d.totals_snapshot->>'vat_rate')::numeric,
            18
          ) / 100),
          2
        )
        ELSE amount_paid
      END
    FROM deals d
    WHERE p.deal_id = d.id
      AND p.deleted_at IS NULL
    RETURNING p.id
  `.then((rows) => ({ count: rows.length }));
  console.log(`  ✓ Updated ${pCount} payment(s)`);

  console.log("Step 3: Recompute deal totals from new payment amounts...");
  const { count: dCount } = await sql`
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
    RETURNING d.id
  `.then((rows) => ({ count: rows.length }));
  console.log(`  ✓ Updated ${dCount} deal(s)`);

  console.log("Step 4: Recompute remaining_amount and payment_status...");
  await sql`
    UPDATE deals
    SET
      remaining_amount = GREATEST(0, ROUND((total_amount - paid_amount)::numeric, 2)),
      payment_status = CASE
        WHEN paid_amount <= 0 THEN 'ממתינה לתשלום'
        WHEN ROUND((total_amount - paid_amount)::numeric, 2) <= 0.01 THEN 'שולמה במלואה'
        ELSE 'תשלום חלקי'
      END
    WHERE deleted_at IS NULL
  `;
  console.log("  ✓ Remaining + status updated");

  console.log("\n✅ Migration complete.");
  await sql.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
