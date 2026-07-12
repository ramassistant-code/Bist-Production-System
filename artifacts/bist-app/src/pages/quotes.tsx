import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Eye, FileText, Search } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { customFetch } from "@workspace/api-client-react";

interface QuoteListItem {
  id: string;
  quote_number: string;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  version_number: number | null;
  version_status: string | null;
  terms_snapshot: { valid_until?: string; project_title?: string } | null;
  totals_snapshot: { total_with_vat?: number } | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה", sent: "נשלחה", approved: "אושרה",
  rejected: "נדחתה", expired: "פג תוקף", cancelled: "בוטלה",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary", sent: "default", approved: "default",
  rejected: "destructive", expired: "outline", cancelled: "destructive",
};

function formatDate(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function formatCurrency(val: number | null | undefined) {
  if (val == null) return "—";
  return `₪${Number(val).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

const DEBOUNCE_MS = 400;
const LIMIT = 100;

export default function Quotes() {
  const [, navigate] = useLocation();
  const [inputSearch, setInputSearch] = useState("");
  const [apiSearch, setApiSearch] = useState("");
  const [apiStatus, setApiStatus] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(0);

  const handleSearch = useCallback((val: string) => {
    setInputSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setApiSearch(val); setPage(0); }, DEBOUNCE_MS);
  }, []);

  const qs = new URLSearchParams();
  if (apiSearch) qs.set("search", apiSearch);
  if (apiStatus) qs.set("status", apiStatus);
  qs.set("limit", String(LIMIT));
  qs.set("offset", String(page * LIMIT));

  const { data: quotes, isLoading, isError } = useQuery<QuoteListItem[]>({
    queryKey: ["quotes", apiSearch, apiStatus, page],
    queryFn: () => customFetch<QuoteListItem[]>(`/api/quotes?${qs}`),
    staleTime: 60_000,
  });

  const showingCount = quotes?.length ?? 0;

  return (
    <Shell title="הצעות מחיר">
      <div className="flex flex-col h-full">
        <div className="shrink-0 px-8 pt-6 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="חיפוש לפי מספר, שם, טלפון..." value={inputSearch}
                  onChange={(e) => handleSearch(e.target.value)} className="w-64 pr-9" dir="rtl" />
              </div>
              <select className="border rounded-md px-3 py-2 text-sm bg-background" value={apiStatus}
                onChange={(e) => { setApiStatus(e.target.value); setPage(0); }} dir="rtl">
                <option value="">כל הסטטוסים</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-3">
              {!isLoading && !isError && <span className="text-sm text-muted-foreground">{showingCount} הצעות</span>}
              <Button onClick={() => navigate("/quotes/new")}>
                <Plus className="w-4 h-4 ml-1" />הצעה חדשה
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden px-8 pb-2">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">טוען הצעות מחיר...</span>
              </div>
            </div>
          )}
          {isError && <div className="flex items-center justify-center h-full"><p className="text-sm text-destructive">שגיאה בטעינת הצעות המחיר</p></div>}
          {!isLoading && !isError && quotes?.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState title={apiSearch || apiStatus ? "לא נמצאו הצעות תואמות" : "אין הצעות מחיר להצגה"}
                description={apiSearch || apiStatus ? "נסו חיפוש אחר" : "לחצו על 'הצעה חדשה' להוספת הצעה ראשונה"} />
            </div>
          )}
          {!isLoading && !isError && quotes && quotes.length > 0 && (
            <div className="h-full overflow-y-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-100">
                  <tr>
                    {["מספר הצעה","לקוח / ליד","טלפון","כותרת","גרסה","סטטוס","סה״כ כולל מע״מ","תוקף עד","תאריך יצירה",""].map((h, i) => (
                      <th key={i} className={`text-right px-4 py-3 font-medium text-gray-600 ${i >= 2 && i <= 3 ? "hidden md:table-cell" : ""} ${i >= 6 && i <= 7 ? "hidden xl:table-cell" : ""} ${i === 8 ? "hidden lg:table-cell" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {quotes.map((q) => {
                    const party = q.customer_name ?? q.lead_name ?? "—";
                    const phone = q.customer_phone ?? q.lead_phone ?? "—";
                    const title = q.terms_snapshot?.project_title ?? "—";
                    const total = formatCurrency(q.totals_snapshot?.total_with_vat);
                    const validUntil = formatDate(q.terms_snapshot?.valid_until);
                    const st = q.version_status ?? q.status;
                    return (
                      <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3"><div className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="font-mono font-medium">{q.quote_number}</span></div></td>
                        <td className="px-4 py-3 font-medium text-gray-900">{party}</td>
                        <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{phone}</td>
                        <td className="px-4 py-3 text-gray-500 hidden md:table-cell truncate max-w-[160px]">{title}</td>
                        <td className="px-4 py-3 text-gray-500">v{q.version_number ?? 1}</td>
                        <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[st] ?? "secondary"}>{STATUS_LABELS[st] ?? st}</Badge></td>
                        <td className="px-4 py-3 font-medium text-gray-800 hidden xl:table-cell">{total}</td>
                        <td className="px-4 py-3 text-gray-500 hidden xl:table-cell">{validUntil}</td>
                        <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{formatDate(q.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => navigate(`/quotes/${q.id}`)} title="צפייה"><Eye className="w-4 h-4" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !isError && (page > 0 || showingCount === LIMIT) && (
          <div className="shrink-0 flex items-center justify-center gap-3 px-8 py-3 border-t bg-white">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>הקודם</Button>
            <span className="text-sm text-muted-foreground">עמוד {page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={showingCount < LIMIT}>הבא</Button>
          </div>
        )}
      </div>
    </Shell>
  );
}
