import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { customFetch } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface DealAuditRow {
  id: string;
  deal_number: string;
  customer_name: string | null;
  party_snapshot: { business_name?: string; contact_name?: string } | null;
  total_amount: string | null;
  total_amount_including_vat: string | null;
  totals_snapshot: Record<string, number> | null;
  monday_item_id?: string | null;
  monday_board_id?: string | null;
  monday_raw_data?: Record<string, unknown> | null;
  execution_status: string;
  created_at: string;
}

interface VatAuditResponse {
  edge_cases: DealAuditRow[];
  edge_case_count: number;
  sample: DealAuditRow[];
  sample_count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatILS(val: string | number | null | undefined) {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getCustomerName(row: DealAuditRow): string {
  if (row.customer_name) return row.customer_name;
  if (row.party_snapshot) {
    return row.party_snapshot.business_name ?? row.party_snapshot.contact_name ?? "—";
  }
  return "—";
}

/** Try to extract a Monday amount value from the raw column_values array */
function extractMondayAmount(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  // Monday item shape: { column_values: [{ id, text, value, ... }] }
  const cols = raw["column_values"] as Array<{ id: string; text?: string; value?: string }> | undefined;
  if (!Array.isArray(cols)) return null;
  // Look for a numeric column whose text looks like a number (amount / paid columns)
  const amountCols = cols.filter(c =>
    c.id && (
      c.id.includes("amount") || c.id.includes("total") || c.id.includes("paid") || c.id.includes("price")
    )
  );
  if (amountCols.length > 0) {
    return amountCols.map(c => `${c.id}: ${c.text ?? c.value ?? "—"}`).join(", ");
  }
  // Fallback: any column whose text parses as a non-zero number
  const numericCols = cols.filter(c => c.text && !isNaN(Number(c.text)) && Number(c.text) !== 0);
  if (numericCols.length > 0) {
    return numericCols.map(c => `${c.id}: ${c.text}`).join(", ");
  }
  return null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function VatAudit() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<VatAuditResponse>({
    queryKey: ["vat-audit"],
    queryFn: () => customFetch<VatAuditResponse>("/api/deals/vat-audit"),
    staleTime: 60 * 1000, // 1 min — this is a manual spot-check tool
  });

  return (
    <Shell title="ביקורת מיגרציית מע״מ">
      <div className="p-6 space-y-8 overflow-auto h-full" dir="rtl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">ביקורת מיגרציית מע״מ</h1>
            <p className="text-sm text-muted-foreground mt-1">
              בדיקת עסקאות לאחר מיגרציית הסכומים — זיהוי שורות בעייתיות והשוואה לנתוני Monday.com
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </button>
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div className="text-sm text-muted-foreground animate-pulse">טוען נתונים...</div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            שגיאה בטעינת הנתונים — {String((error as Error).message ?? error)}
          </div>
        )}

        {data && (
          <>
            {/* ── Section 1: Edge cases ────────────────────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                {data.edge_case_count === 0 ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                )}
                <h2 className="text-base font-semibold">
                  עסקאות עם סכום 0 וללא סכום כולל מע״מ
                  <span className="mr-2 text-sm font-normal text-muted-foreground">
                    ({data.edge_case_count} נמצאו)
                  </span>
                </h2>
              </div>

              {data.edge_case_count === 0 ? (
                <p className="text-sm text-muted-foreground bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3">
                  לא נמצאו עסקאות עם בעיה זו — המיגרציה הצליחה עבור כל הרשומות.
                </p>
              ) : (
                <div className="rounded-xl border border-amber-200 overflow-hidden">
                  <div className="bg-amber-500/10 px-4 py-2 text-xs text-amber-700 border-b border-amber-500/20">
                    עסקאות אלו יש לתקן ידנית — לא ניתן לחשב סכום מהנתונים הקיימים
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-muted-foreground text-xs">
                          <th className="px-4 py-2.5 text-right font-medium">מספר עסקה</th>
                          <th className="px-4 py-2.5 text-right font-medium">לקוח</th>
                          <th className="px-4 py-2.5 text-right font-medium">total_amount</th>
                          <th className="px-4 py-2.5 text-right font-medium">total_incl_vat</th>
                          <th className="px-4 py-2.5 text-right font-medium">snapshot subtotal</th>
                          <th className="px-4 py-2.5 text-right font-medium">סטטוס</th>
                          <th className="px-4 py-2.5 text-right font-medium">נוצרה</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.edge_cases.map((row) => (
                          <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs">{row.deal_number}</td>
                            <td className="px-4 py-2.5">{getCustomerName(row)}</td>
                            <td className="px-4 py-2.5 text-amber-700 font-medium">{formatILS(row.total_amount)}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{formatILS(row.total_amount_including_vat)}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {row.totals_snapshot
                                ? formatILS(row.totals_snapshot["subtotal_after_discount"] ?? row.totals_snapshot["total_with_vat"])
                                : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="text-xs px-2 py-0.5 bg-muted rounded-full">{row.execution_status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(row.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* ── Section 2: Monday comparison sample ─────────────────────── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">
                  השוואת סכומים — עסקאות מסונכרנות ל-Monday
                  <span className="mr-2 text-sm font-normal text-muted-foreground">
                    ({data.sample_count} עסקאות עם monday_item_id)
                  </span>
                </h2>
              </div>

              {data.sample_count === 0 ? (
                <p className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-xl px-4 py-3">
                  לא נמצאו עסקאות מסונכרנות ל-Monday — לא ניתן לבצע השוואה.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    <strong>total_amount</strong> הוא הסכום ללא מע״מ שנשלח ל-Monday.
                    עמודת <strong>monday_raw_data amounts</strong> מציגה ערכים מהתגובה האחרונה של Monday — ניתן לאמת מולה.
                    לחיצה על מזהה ה-item פותחת את הפריט ב-Monday.com.
                  </p>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/40 text-muted-foreground text-xs border-b border-border">
                            <th className="px-4 py-2.5 text-right font-medium">מספר עסקה</th>
                            <th className="px-4 py-2.5 text-right font-medium">לקוח</th>
                            <th className="px-4 py-2.5 text-right font-medium">total_amount (ללא מע״מ)</th>
                            <th className="px-4 py-2.5 text-right font-medium">total_incl_vat</th>
                            <th className="px-4 py-2.5 text-right font-medium">monday_raw_data amounts</th>
                            <th className="px-4 py-2.5 text-right font-medium">Monday Item</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {data.sample.map((row) => {
                            const mondayAmount = extractMondayAmount(row.monday_raw_data);
                            const dbAmount = Number(row.total_amount ?? 0);
                            // Highlight if no monday data or if raw data has no readable amounts
                            const hasNoMondayData = !row.monday_raw_data || mondayAmount === null;

                            return (
                              <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                                <td className="px-4 py-2.5 font-mono text-xs">{row.deal_number}</td>
                                <td className="px-4 py-2.5">{getCustomerName(row)}</td>
                                <td className={`px-4 py-2.5 font-medium ${dbAmount === 0 ? "text-amber-600" : "text-foreground"}`}>
                                  {formatILS(row.total_amount)}
                                </td>
                                <td className="px-4 py-2.5 text-muted-foreground">
                                  {formatILS(row.total_amount_including_vat)}
                                </td>
                                <td className="px-4 py-2.5 text-xs">
                                  {hasNoMondayData ? (
                                    <span className="text-muted-foreground italic">אין נתוני Monday</span>
                                  ) : (
                                    <span className="font-mono text-foreground/80">{mondayAmount}</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  {row.monday_item_id ? (
                                    <a
                                      href={`https://monday.com/boards/${row.monday_board_id ?? ""}/pulses/${row.monday_item_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                    >
                                      {row.monday_item_id}
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
