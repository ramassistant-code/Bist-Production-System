import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { customFetch } from "@workspace/api-client-react";
import { Eye, ChevronRight, ChevronLeft, Search, X, Plus } from "lucide-react";
import DealFormDialog from "@/components/deals/deal-form-dialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface DealRow {
  id: string;
  deal_number: string;
  customer_name: string | null;
  total_amount: string | null;              // ex-VAT (for Monday)
  total_amount_including_vat: string | null; // inclusive (for display)
  execution_status: string;
  payment_status: string | null;
  source_quote_version_id: string | null;
  quote_number: string | null;
  party_snapshot: {
    business_name?: string;
    contact_name?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface DealsResponse {
  deals: DealRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXECUTION_STATUS_VARIANT: Record<
  string,
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "success"
  | "warning"
  | "info"
> = {
  // Values actually present in the data
  פתוחה: "info",
  בעבודה: "warning",
  בוצע: "success",
  // Kept for older / imported records
  "ממתינה לתיאום": "secondary",
  בטיפול: "warning",
  הושלמה: "success",
  בוטלה: "destructive",
};

const EXECUTION_STATUS_OPTIONS = [
  { value: "", label: "כל הסטטוסים" },
  { value: "פתוחה", label: "פתוחה" },
  { value: "ממתינה לתיאום", label: "ממתינה לתיאום" },
  { value: "בעבודה", label: "בעבודה" },
  { value: "הושלמה", label: "הושלמה" },
  { value: "בוטלה", label: "בוטלה" },
];

function formatDate(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatILS(val: string | number | null | undefined) {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getCustomerDisplayName(row: DealRow): string {
  if (row.customer_name) return row.customer_name;
  if (row.party_snapshot) {
    return row.party_snapshot.business_name ?? row.party_snapshot.contact_name ?? "—";
  }
  return "—";
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Deals() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [executionStatus, setExecutionStatus] = useState("");
  const [page, setPage] = useState(1);
  const [inputValue, setInputValue] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const handleSearch = useCallback(() => {
    setSearch(inputValue);
    setPage(1);
  }, [inputValue]);

  const handleClearSearch = useCallback(() => {
    setInputValue("");
    setSearch("");
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((val: string) => {
    setExecutionStatus(val);
    setPage(1);
  }, []);

  const params = new URLSearchParams();
  params.set("page", String(page));
  if (search) params.set("search", search);
  if (executionStatus) params.set("execution_status", executionStatus);

  const { data, isLoading, isError } = useQuery<DealsResponse>({
    queryKey: ["deals", page, search, executionStatus],
    queryFn: () => customFetch<DealsResponse>(`/api/deals?${params.toString()}`),
    staleTime: 30_000,
  });

  const deals = data?.deals ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <Shell title="עסקאות">
      <div className="h-full overflow-y-auto px-8 py-6" dir="rtl">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground">עסקאות</h1>
              {!isLoading && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {total.toLocaleString("he-IL")} עסקאות
                </p>
              )}
            </div>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="w-4 h-4" />
              עסקה חדשה
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2 flex-1 min-w-[240px] max-w-sm">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש לפי מספר עסקה, לקוח או הצעה..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pr-9"
                />
                {inputValue && (
                  <button
                    onClick={handleClearSearch}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleSearch} className="shrink-0">
                חפש
              </Button>
            </div>

            <select
              value={executionStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm text-right"
            >
              {EXECUTION_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-muted-foreground">טוען עסקאות...</span>
                </div>
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-destructive">שגיאה בטעינת העסקאות</p>
              </div>
            ) : deals.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">לא נמצאו עסקאות</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/50">
                      {/* Every other column is nowrap at its content width, so the
                          deal-number column absorbed all the slack — 424px for a
                          13-character code — and pushed the table past its
                          container. In RTL the overflow clips on the left, which
                          is where the actions column lives. */}
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap w-[150px]">מספר עסקה</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם לקוח</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">מקור</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">סכום עסקה</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">תאריך פתיחה</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">עדכון אחרון</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((deal, idx) => (
                      <tr
                        key={deal.id}
                        className={`border-b border-border/30 hover:bg-muted/50 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/50/30"}`}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-foreground/80 whitespace-nowrap">
                          {deal.deal_number}
                        </td>
                        <td className="px-4 py-3 text-foreground/70 max-w-[160px] truncate">
                          {getCustomerDisplayName(deal)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {deal.source_quote_version_id ? (
                            <span className="text-primary text-xs font-medium">
                              {deal.quote_number ? `הצעה ${deal.quote_number}` : "הצעת מחיר"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">ייבוא היסטורי</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground/70 whitespace-nowrap font-medium">
                          {formatILS(deal.total_amount_including_vat ?? deal.total_amount)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={EXECUTION_STATUS_VARIANT[deal.execution_status] ?? "secondary"}
                            className="text-xs whitespace-nowrap"
                          >
                            {deal.execution_status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                          {formatDate(deal.created_at)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                          {formatDate(deal.updated_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => navigate(`/deals/${deal.id}`)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            צפייה
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

      {/* Create dialog */}
      <DealFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => { setCreateOpen(false); }}
      />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                עמוד {page} מתוך {totalPages} ({total.toLocaleString("he-IL")} תוצאות)
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </Shell>
  );
}
