import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, Plus, AlertCircle, CheckCircle, XCircle, Send, Handshake, FileDown } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth-context";
import OpenDealModal from "@/components/deals/open-deal-modal";

// ── Types ──────────────────────────────────────────────────────────────────

interface PartySnapshot {
  party_type: "customer" | "lead";
  business_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
}
interface ItemComponent {
  component_name_snapshot?: string;
  component_description_snapshot?: string;
  quantity?: number;
  unit_cost_snapshot?: number;
  customer_note?: string;
  internal_note?: string;
}
interface SnapshotItem {
  product_name_snapshot?: string;
  product_description_snapshot?: string;
  quantity?: number;
  unit_price?: number;
  line_subtotal?: number;
  line_total_with_vat?: number;
  manual_price_override?: boolean;
  price_override_reason?: string;
  customer_note?: string;
  internal_note?: string;
  components_snapshot?: ItemComponent[];
}
interface TotalsSnapshot {
  subtotal_before_discount?: number;
  discount_amount?: number;
  subtotal_after_discount?: number;
  vat_amount?: number;
  vat_rate?: number;
  total_with_vat?: number;
  cost_total?: number;
  gross_profit_amount?: number;
  gross_profit_percent?: number;
  basket_total_manually_overridden?: boolean;
  basket_override_note?: string;
}
interface TermsSnapshot {
  project_title?: string;
  valid_until?: string;
  payment_terms?: string;
  deposit_amount?: number;
  remaining_balance?: number;
  delivery_terms?: string;
  generate_pdf?: boolean;
}
interface NotesSnapshot {
  customer_notes?: string;
  operation_notes?: string;
  internal_notes?: string;
}
interface QuoteVersion {
  id: string;
  quote_id: string;
  version_number: number;
  status: string;
  party_snapshot: PartySnapshot | null;
  items_snapshot: SnapshotItem[] | null;
  totals_snapshot: TotalsSnapshot | null;
  terms_snapshot: TermsSnapshot | null;
  notes_snapshot: NotesSnapshot | null;
  created_at: string;
  sent_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
}
interface QuoteRow {
  id: string;
  quote_number: string;
  status: string;
  customer_id: string | null;
  lead_id: string | null;
  current_version_id: string | null;
  customer_name?: string;
  customer_phone?: string;
  lead_name?: string;
  lead_phone?: string;
  created_at: string;
}
interface QuoteDetailData {
  quote: QuoteRow;
  currentVersion: QuoteVersion | null;
  versions: Array<{ id: string; version_number: number; status: string; created_at: string; sent_at: string | null; approved_at: string | null; locked_at: string | null }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה", sent: "נשלחה ללקוח", approved: "נחתמה",
  rejected: "נדחתה", expired: "פג תוקף", cancelled: "בוטלה",
  "טיוטה": "טיוטה", "נשלחה ללקוח": "נשלחה ללקוח", "נחתמה": "נחתמה",
  "נדחתה": "נדחתה", "פג תוקף": "פג תוקף", "בוטלה": "בוטלה",
  "מוכנה לשליחה": "מוכנה לשליחה", "נצפתה": "נצפתה", "ממתינה לחתימה": "ממתינה לחתימה",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary", sent: "default", approved: "default",
  rejected: "destructive", expired: "outline", cancelled: "destructive",
  "טיוטה": "secondary", "נשלחה ללקוח": "default", "נחתמה": "default",
  "נדחתה": "destructive", "פג תוקף": "outline", "בוטלה": "destructive",
  "מוכנה לשליחה": "secondary", "נצפתה": "secondary", "ממתינה לחתימה": "secondary",
};

function formatDate(val: string | null | undefined) {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}
function formatILS(n: number | null | undefined) {
  if (n == null) return "—";
  return `₪${Number(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "info", label: "פרטי הצעה" },
  { key: "items", label: "שורות" },
  { key: "terms", label: "תנאים והערות" },
  { key: "versions", label: "גרסאות" },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function QuotesDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { appUser, session } = useAuth();
  const [tab, setTab] = useState("info");
  const [showOpenDealModal, setShowOpenDealModal] = useState(false);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<QuoteDetailData>({
    queryKey: ["quote", id],
    queryFn: () => customFetch<QuoteDetailData>(`/api/quotes/${id}`),
    staleTime: 30_000,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      customFetch(`/api/quotes/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["quote", id] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      const msg = { sent: "ההצעה סומנה כנשלחה וננעלה לעריכה", approved: "גרסת ההצעה אושרה וננעלה", rejected: "ההצעה סומנה כנדחתה", cancelled: "ההצעה בוטלה" };
      toast({ title: msg[status as keyof typeof msg] ?? "הסטטוס עודכן" });
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({ title: err?.data?.error ?? "שגיאה בעדכון סטטוס", variant: "destructive" });
    },
  });


  const ver = data?.currentVersion;
  const isApprovedAndLocked = !!ver?.id && ver?.status === "approved" && !!ver?.locked_at;

  const { data: dealCheck } = useQuery<{ exists: boolean; deal_id?: string }>({
    queryKey: ["deal-check", ver?.id],
    queryFn: () => customFetch<{ exists: boolean; deal_id?: string }>(`/api/deals/check-version/${ver!.id}`),
    enabled: isApprovedAndLocked,
    staleTime: 0,
  });

  const { data: existingPdf } = useQuery<{
    url: string;
    document_id: string;
    download_filename: string;
    revision: number;
  } | null>({
    queryKey: ["quote-latest-pdf", ver?.id],
    queryFn: () =>
      customFetch(`/api/quote-versions/${ver!.id}/latest-pdf`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      }).catch(() => null) as Promise<{ url: string; document_id: string; download_filename: string; revision: number } | null>,
    enabled: !!ver?.id && !!session?.access_token,
    staleTime: 0,
    retry: false,
  });

  const pdfMutation = useMutation({
    mutationFn: (versionId: string) =>
      customFetch<{ url: string; document_id: string; download_filename: string }>(
        `/api/quote-versions/${versionId}/generate-pdf`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({ templateId: null }),
        },
      ),
    onSuccess: (result) => {
      setLastPdfUrl(result.url);
      queryClient.invalidateQueries({ queryKey: ["quote-latest-pdf", ver?.id] });
      // Use anchor click to bypass popup blockers
      const a = document.createElement("a");
      a.href = result.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: "ה-PDF נוצר בהצלחה", description: result.download_filename });
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({
        title: "שגיאה ביצירת PDF",
        description: err?.data?.error ?? err?.message ?? "שגיאה לא ידועה",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Shell title="הצעת מחיר">
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">טוען הצעת מחיר...</span>
          </div>
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell title="הצעת מחיר">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-destructive">הצעת המחיר לא נמצאה</p>
        </div>
      </Shell>
    );
  }

  const { quote, currentVersion: verData, versions } = data;
  const party = verData?.party_snapshot;
  const totals = verData?.totals_snapshot;
  const terms = verData?.terms_snapshot;
  const notes = verData?.notes_snapshot;
  const items = verData?.items_snapshot ?? [];
  const vStatus = verData?.status ?? quote.status;
  const isLocked = !!verData?.locked_at;
  const isDraft = vStatus === "draft" && !isLocked;
  const partyName = party?.business_name || party?.contact_name || quote.customer_name || quote.lead_name || "—";

  const canOpenDeal = isApprovedAndLocked && !dealCheck?.exists;
  const dealAlreadyExists = isApprovedAndLocked && dealCheck?.exists;

  return (
    <>
    <Shell title={`הצעה ${quote.quote_number}`}>
      <div className="h-full overflow-y-auto px-8 py-6" dir="rtl">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Button variant="ghost" size="sm" onClick={() => navigate("/quotes")} className="h-7 px-2">
                  <ChevronRight className="w-4 h-4 ml-0.5" />רשימת הצעות
                </Button>
              </div>
              <h1 className="text-xl font-bold text-foreground">{quote.quote_number}</h1>
              {terms?.project_title && <p className="text-muted-foreground text-sm mt-0.5">{terms.project_title}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={STATUS_VARIANT[vStatus] ?? "secondary"} className="text-sm px-3 py-1">
                {STATUS_LABELS[vStatus] ?? vStatus}
              </Badge>
              {isDraft && (
                <Button size="sm" variant="outline" onClick={() => statusMutation.mutate("sent")} disabled={statusMutation.isPending}>
                  <Send className="w-3.5 h-3.5 ml-1" />סמן כנשלחה
                </Button>
              )}
              {vStatus === "sent" && (
                <>
                  <Button size="sm" variant="outline" className="text-green-700 border-green-200 hover:bg-green-50"
                    onClick={() => statusMutation.mutate("approved")} disabled={statusMutation.isPending}>
                    <CheckCircle className="w-3.5 h-3.5 ml-1" />אשר
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive border-red-200 hover:bg-red-50"
                    onClick={() => statusMutation.mutate("rejected")} disabled={statusMutation.isPending}>
                    <XCircle className="w-3.5 h-3.5 ml-1" />דחה
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline"
                onClick={() => navigate(`/quotes/${id}/new-version`)} disabled={isLocked && vStatus !== "approved" && vStatus !== "rejected"}>
                <Plus className="w-3.5 h-3.5 ml-1" />גרסה חדשה
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(`/quotes/${id}/duplicate`)}>
                <Copy className="w-3.5 h-3.5 ml-1" />הצעה חדשה מזו
              </Button>
              {verData?.id && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pdfMutation.isPending}
                  onClick={() => pdfMutation.mutate(verData.id)}
                  className="text-blue-700 border-blue-200 hover:bg-blue-50"
                >
                  <FileDown className="w-3.5 h-3.5 ml-1" />
                  {pdfMutation.isPending ? "מייצר PDF..." : "הפק PDF"}
                </Button>
              )}
              {(lastPdfUrl ?? existingPdf?.url) && (
                <Button
                  size="sm"
                  variant="ghost"
                  asChild
                  className="text-blue-600"
                >
                  <a href={(lastPdfUrl ?? existingPdf?.url)!} target="_blank" rel="noopener noreferrer">
                    <FileDown className="w-3.5 h-3.5 ml-1" />פתח PDF
                  </a>
                </Button>
              )}
              {canOpenDeal && (
                <Button
                  size="sm"
                  variant="default"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setShowOpenDealModal(true)}
                >
                  <Handshake className="w-3.5 h-3.5 ml-1" />
                  פתח עסקה
                </Button>
              )}
              {dealAlreadyExists && dealCheck?.deal_id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-700 border-green-200 hover:bg-green-50"
                  onClick={() => navigate(`/deals/${dealCheck.deal_id}`)}
                >
                  <Handshake className="w-3.5 h-3.5 ml-1" />
                  צפה בעסקה
                </Button>
              )}
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "לקוח / ליד", value: partyName },
              { label: "סה״כ כולל מע״מ", value: formatILS(totals?.total_with_vat) },
              { label: "תוקף עד", value: formatDate(terms?.valid_until) },
              { label: "גרסה", value: `v${verData?.version_number ?? 1}` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-foreground mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {isLocked && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-yellow-50 border border-yellow-100 rounded-lg px-4 py-2">
              <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0" />
              גרסה זו נעולה לעריכה. כדי לשנות — יש ליצור גרסה חדשה.
            </div>
          )}

          {/* Tabs */}
          <div className="border-b border-border">
            <div className="flex gap-0">
              {TABS.map((t) => (
                <button key={t.key} type="button"
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground/70"}`}
                  onClick={() => setTab(t.key)}>
                  {t.label}
                  {t.key === "versions" && versions.length > 0 && (
                    <Badge variant="secondary" className="mr-1.5 text-xs py-0 h-4">{versions.length}</Badge>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab: Info */}
          {tab === "info" && (
            <div className="space-y-4" dir="rtl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground/70">פרטי צד</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">שם</span><span className="font-medium">{partyName}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">טלפון</span><span>{party?.phone ?? "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">אימייל</span><span>{party?.email ?? "—"}</span></div>
                    {party?.tax_id && <div className="flex justify-between"><span className="text-muted-foreground">ח.פ / עוסק</span><span>{party.tax_id}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">סוג</span><span>{party?.party_type === "customer" ? "לקוח" : "ליד"}</span></div>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground/70">פרטי הצעה</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">מספר הצעה</span><span className="font-mono font-medium">{quote.quote_number}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">סטטוס</span><Badge variant={STATUS_VARIANT[vStatus] ?? "secondary"} className="text-xs">{STATUS_LABELS[vStatus] ?? vStatus}</Badge></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">גרסה</span><span>v{verData?.version_number ?? 1}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">תאריך יצירה</span><span>{formatDate(quote.created_at)}</span></div>
                    {verData?.sent_at && <div className="flex justify-between"><span className="text-muted-foreground">נשלחה</span><span>{formatDate(verData.sent_at)}</span></div>}
                    {verData?.approved_at && <div className="flex justify-between"><span className="text-muted-foreground">אושרה</span><span>{formatDate(verData.approved_at)}</span></div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab: Items */}
          {tab === "items" && (
            <div className="space-y-3" dir="rtl">
              {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין שורות להצגה</p>}
              {items.map((item, i) => (
                <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="flex items-start justify-between px-4 py-3 bg-muted/50 border-b border-border/50">
                    <div>
                      <p className="font-medium text-foreground">{item.product_name_snapshot}</p>
                      {item.product_description_snapshot && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.product_description_snapshot}</p>}
                    </div>
                    <div className="text-left shrink-0 mr-3">
                      <p className="font-bold text-foreground/80">{formatILS(item.line_subtotal)}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity} × {formatILS(item.unit_price)}</p>
                    </div>
                  </div>
                  {(item.customer_note || item.internal_note || (item.components_snapshot && item.components_snapshot.length > 0)) && (
                    <div className="px-4 py-3 space-y-2">
                      {item.customer_note && <div className="text-xs"><span className="text-muted-foreground">הערת לקוח: </span>{item.customer_note}</div>}
                      {item.internal_note && <div className="text-xs"><span className="text-muted-foreground">הערה למחלקת אופרציה: </span>{item.internal_note}</div>}
                      {item.manual_price_override && item.price_override_reason && (
                        <div className="text-xs text-orange-700"><span className="font-medium">סיבת שינוי מחיר: </span>{item.price_override_reason}</div>
                      )}
                      {item.components_snapshot && item.components_snapshot.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">{item.components_snapshot.length} רכיבים:</p>
                          <div className="space-y-1">
                            {item.components_snapshot.map((c, ci) => (
                              <div key={ci} className="text-xs bg-muted/50 rounded px-2 py-1 space-y-0.5">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <span className="font-medium text-foreground">{c.component_name_snapshot}</span>
                                  <span>× {c.quantity}</span>
                                  {c.customer_note && <span className="text-amber-700 mr-auto">{c.customer_note}</span>}
                                </div>
                                {c.internal_note && (
                                  <div className="text-blue-700"><span className="text-muted-foreground">הערה פנימית: </span>{c.internal_note}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Totals */}
              {totals && (
                <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">סה״כ לפני הנחה</span><span>{formatILS(totals.subtotal_before_discount)}</span></div>
                  {(totals.discount_amount ?? 0) > 0 && <div className="flex justify-between text-green-700"><span>הנחה</span><span>-{formatILS(totals.discount_amount)}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">סה״כ אחרי הנחה</span><span>{formatILS(totals.subtotal_after_discount)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>מע״מ {Math.round((totals.vat_rate ?? 0.18) * 100)}%</span><span>{formatILS(totals.vat_amount)}</span></div>
                  <Separator />
                  <div className="flex justify-between font-bold text-base"><span>סה״כ כולל מע״מ</span><span className="text-primary">{formatILS(totals.total_with_vat)}</span></div>
                  {(totals.cost_total ?? 0) > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground pt-1">
                      <span>רווח גולמי</span>
                      <span>{formatILS(totals.gross_profit_amount)} ({totals.gross_profit_percent}%)</span>
                    </div>
                  )}
                  {totals.basket_total_manually_overridden && totals.basket_override_note && (
                    <div className="text-xs text-orange-700 pt-1"><span className="font-medium">הערת שינוי סל: </span>{totals.basket_override_note}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab: Terms + Notes */}
          {tab === "terms" && (
            <div className="space-y-4" dir="rtl">
              {terms && (
                <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
                  <h3 className="font-semibold text-foreground/70 mb-3">תנאים</h3>
                  {terms.payment_terms && <div className="flex justify-between"><span className="text-muted-foreground">תנאי תשלום</span><span>{terms.payment_terms}</span></div>}
                  {terms.valid_until && <div className="flex justify-between"><span className="text-muted-foreground">תוקף עד</span><span>{formatDate(terms.valid_until)}</span></div>}
                  {(terms.deposit_amount ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">מקדמה</span><span>{formatILS(terms.deposit_amount)}</span></div>}
                  {(terms.remaining_balance ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">יתרה לתשלום</span><span>{formatILS(terms.remaining_balance)}</span></div>}
                  {terms.delivery_terms && <div className="flex justify-between"><span className="text-muted-foreground">זמן אספקה</span><span>{terms.delivery_terms}</span></div>}
                </div>
              )}
              {notes && (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <h3 className="font-semibold text-foreground/70">הערות</h3>
                  {notes.customer_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">הערות ללקוח (מוצגות ללקוח)</p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-blue-50 rounded p-2">{notes.customer_notes}</p>
                    </div>
                  )}
                  {notes.operation_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">הערות לצוות האופרציה (פנימי)</p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-muted/50 rounded p-2">{notes.operation_notes}</p>
                    </div>
                  )}
                  {notes.internal_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">הערות פנימיות (פנימי)</p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-muted/50 rounded p-2">{notes.internal_notes}</p>
                    </div>
                  )}
                  {!notes.customer_notes && !notes.operation_notes && !notes.internal_notes && (
                    <p className="text-sm text-muted-foreground">אין הערות</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab: Versions */}
          {tab === "versions" && (
            <div className="space-y-2" dir="rtl">
              {versions.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">אין גרסאות</p>}
              {versions.map((v) => (
                <div key={v.id} className="rounded-lg border border-border p-4 flex items-center justify-between bg-card">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">גרסה {v.version_number}</span>
                      <Badge variant={STATUS_VARIANT[v.status] ?? "secondary"} className="text-xs">{STATUS_LABELS[v.status] ?? v.status}</Badge>
                      {v.id === data.quote.current_version_id && (
                        <Badge variant="outline" className="text-xs">נוכחית</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">נוצרה: {formatDate(v.created_at)}</p>
                    {v.sent_at && <p className="text-xs text-muted-foreground">נשלחה: {formatDate(v.sent_at)}</p>}
                    {v.approved_at && <p className="text-xs text-green-700">אושרה: {formatDate(v.approved_at)}</p>}
                    {v.locked_at && <p className="text-xs text-orange-600">ננעלה: {formatDate(v.locked_at)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </Shell>

    {showOpenDealModal && verData && (
      <OpenDealModal
        quote={quote}
        version={verData}
        currentUser={appUser}
        onClose={() => setShowOpenDealModal(false)}
        onSuccess={(dealId, dealNumber) => {
          toast({ title: `עסקה ${dealNumber} נפתחה בהצלחה` });
          queryClient.invalidateQueries({ queryKey: ["deal-check", verData.id] });
          setShowOpenDealModal(false);
          navigate(`/deals/${dealId}`);
        }}
      />
    )}
    </>
  );
}
