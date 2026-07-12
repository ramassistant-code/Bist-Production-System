import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { ChevronRight, Pencil, AlertCircle } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PartySnapshot {
  party_type?: "customer" | "lead";
  business_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
}

interface ComponentSnap {
  component_name_snapshot?: string;
  component_description_snapshot?: string;
  quantity?: number;
  customer_note?: string;
}

interface ItemSnapshot {
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
  components_snapshot?: ComponentSnap[];
}

interface TotalsSnapshot {
  subtotal_before_discount?: number;
  discount_amount?: number;
  subtotal_after_discount?: number;
  vat_rate?: number;
  vat_amount?: number;
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
}

interface NotesSnapshot {
  customer_notes?: string;
  operation_notes?: string;
  internal_notes?: string;
}

interface DealDetail {
  id: string;
  deal_number: string;
  quote_id: string | null;
  customer_id: string | null;
  lead_id: string | null;
  payment_status: string | null;
  execution_status: string;
  purchase_date: string | null;
  next_payment_date: string | null;
  total_amount: string | null;
  paid_amount: string | null;
  remaining_amount: string | null;
  quote_link: string | null;
  what_is_included: string | null;
  special_notes: string | null;
  studio_hours_remaining: string | null;
  editing_tasks_remaining: string | null;
  source_quote_version_id: string | null;
  party_snapshot: PartySnapshot | null;
  items_snapshot: ItemSnapshot[] | null;
  totals_snapshot: TotalsSnapshot | null;
  terms_snapshot: TermsSnapshot | null;
  notes_snapshot: NotesSnapshot | null;
  snapshot_locked_at: string | null;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  quote_number: string | null;
  version_number: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const EXECUTION_STATUSES = [
  "פתוחה",
  "ממתינה לתיאום",
  "בטיפול",
  "הושלמה",
  "בוטלה",
];
const PAYMENT_STATUSES = [
  "ממתינה לתשלום",
  "תשלום חלקי",
  "שולמה במלואה",
];

const EXEC_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  פתוחה: "secondary",
  "ממתינה לתיאום": "secondary",
  בטיפול: "default",
  הושלמה: "default",
  בוטלה: "destructive",
};

const PAY_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  "ממתינה לתשלום": "outline",
  "תשלום חלקי": "secondary",
  "שולמה במלואה": "default",
};

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
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

interface EditModalProps {
  deal: DealDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ deal, open, onClose, onSaved }: EditModalProps) {
  const { toast } = useToast();
  const [execStatus, setExecStatus] = useState(deal.execution_status);
  const [payStatus, setPayStatus] = useState(deal.payment_status ?? "");
  const [notes, setNotes] = useState(deal.special_notes ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          execution_status: execStatus,
          payment_status: payStatus || undefined,
          special_notes: notes,
        }),
      }),
    onSuccess: () => {
      toast({ title: "פרטי העסקה עודכנו" });
      onSaved();
      onClose();
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({
        title: err?.data?.error ?? "שגיאה בשמירת השינויים",
        variant: "destructive",
      });
    },
  });

  const requiresNote = execStatus === "בוטלה";
  const canSubmit = !requiresNote || notes.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>עריכת עסקה {deal.deal_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">סטטוס ביצוע</label>
            <select
              value={execStatus}
              onChange={(e) => setExecStatus(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              {EXECUTION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {execStatus === "בוטלה" && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                נדרשת הערה בעת ביטול עסקה
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">סטטוס תשלום</label>
            <select
              value={payStatus}
              onChange={(e) => setPayStatus(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="">— ללא סטטוס תשלום —</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              הערות פנימיות / אופרציה
              {requiresNote && <span className="text-destructive mr-1">*</span>}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={requiresNote ? "הזן סיבת ביטול..." : "הערות פנימיות..."}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ביטול
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
          >
            {mutation.isPending ? "שומר..." : "שמור"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DealsDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: deal, isLoading, isError } = useQuery<DealDetail>({
    queryKey: ["deal", id],
    queryFn: () => customFetch<DealDetail>(`/api/deals/${id}`),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Shell title="עסקה">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">טוען עסקה...</span>
          </div>
        </div>
      </Shell>
    );
  }

  if (isError || !deal) {
    return (
      <Shell title="עסקה">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-destructive">העסקה לא נמצאה</p>
        </div>
      </Shell>
    );
  }

  const isQuoteBased = !!deal.source_quote_version_id;
  const party = deal.party_snapshot;
  const items = deal.items_snapshot ?? [];
  const totals = deal.totals_snapshot;
  const terms = deal.terms_snapshot;
  const notes = deal.notes_snapshot;

  const customerDisplayName =
    party?.business_name ?? party?.contact_name ?? deal.customer_name ?? "—";

  return (
    <Shell title={`עסקה ${deal.deal_number}`}>
      <div className="h-full overflow-y-auto px-8 py-6" dir="rtl">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/deals")}
                  className="h-7 px-2"
                >
                  <ChevronRight className="w-4 h-4 ml-0.5" />
                  רשימת עסקאות
                </Button>
              </div>
              <h1 className="text-xl font-bold text-gray-900">{deal.deal_number}</h1>
              {isQuoteBased && deal.quote_number && (
                <p className="text-muted-foreground text-sm mt-0.5">
                  מבוסס על הצעה{" "}
                  <button
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => navigate(`/quotes/${deal.quote_id}`)}
                  >
                    {deal.quote_number}
                  </button>
                  {deal.version_number != null && ` גרסה v${deal.version_number}`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant={EXEC_STATUS_VARIANT[deal.execution_status] ?? "secondary"}
                className="text-sm px-3 py-1"
              >
                {deal.execution_status}
              </Badge>
              {deal.payment_status && (
                <Badge
                  variant={PAY_STATUS_VARIANT[deal.payment_status] ?? "outline"}
                  className="text-sm px-3 py-1"
                >
                  {deal.payment_status}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="w-3.5 h-3.5 ml-1" />
                עריכה
              </Button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "לקוח", value: customerDisplayName },
              { label: "סכום עסקה", value: formatILS(deal.total_amount) },
              { label: "שולם", value: formatILS(deal.paid_amount) },
              { label: "יתרה", value: formatILS(deal.remaining_amount) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-gray-200 p-3 bg-white">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-gray-900 mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* Source badge */}
          {!isQuoteBased && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
              <AlertCircle className="w-4 h-4 text-gray-400 shrink-0" />
              עסקה ממוקד ייבוא היסטורי (Monday.com) — אין נתוני הצעת מקור
            </div>
          )}

          {/* ── Quote-based deal content ── */}
          {isQuoteBased && (
            <>
              {/* Party info from snapshot */}
              {party && (
                <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-white">
                  <h3 className="text-sm font-semibold text-gray-700">פרטי לקוח (מהצעת המחיר)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">שם</span>
                      <span className="font-medium">{customerDisplayName}</span>
                    </div>
                    {party.phone && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">טלפון</span>
                        <span>{party.phone}</span>
                      </div>
                    )}
                    {party.email && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">אימייל</span>
                        <span>{party.email}</span>
                      </div>
                    )}
                    {party.tax_id && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">ח.פ / עוסק</span>
                        <span>{party.tax_id}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Items */}
              {items.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">סל מוצרים</h3>
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                    >
                      <div className="flex items-start justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                        <div>
                          <p className="font-medium text-gray-900">
                            {item.product_name_snapshot}
                          </p>
                          {item.product_description_snapshot && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {item.product_description_snapshot}
                            </p>
                          )}
                        </div>
                        <div className="text-left shrink-0 mr-3">
                          <p className="font-bold text-gray-800">
                            {formatILS(item.line_subtotal)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantity} × {formatILS(item.unit_price)}
                          </p>
                        </div>
                      </div>
                      {(item.customer_note ||
                        item.internal_note ||
                        (item.components_snapshot && item.components_snapshot.length > 0)) && (
                        <div className="px-4 py-3 space-y-2">
                          {item.customer_note && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">הערת לקוח: </span>
                              {item.customer_note}
                            </div>
                          )}
                          {item.internal_note && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">הערה פנימית: </span>
                              {item.internal_note}
                            </div>
                          )}
                          {item.manual_price_override && item.price_override_reason && (
                            <div className="text-xs text-orange-700">
                              <span className="font-medium">סיבת שינוי מחיר: </span>
                              {item.price_override_reason}
                            </div>
                          )}
                          {item.components_snapshot && item.components_snapshot.length > 0 && (
                            <div className="mt-1">
                              <p className="text-xs font-medium text-gray-500 mb-1">
                                {item.components_snapshot.length} רכיבים:
                              </p>
                              <div className="space-y-1">
                                {item.components_snapshot.map((c, ci) => (
                                  <div
                                    key={ci}
                                    className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1"
                                  >
                                    <span className="font-medium">
                                      {c.component_name_snapshot}
                                    </span>
                                    <span className="text-muted-foreground">× {c.quantity}</span>
                                    {c.customer_note && (
                                      <span className="text-blue-600 mr-auto">
                                        {c.customer_note}
                                      </span>
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
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1.5 text-sm">
                      {(totals.subtotal_before_discount ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">סה״כ לפני הנחה</span>
                          <span>{formatILS(totals.subtotal_before_discount)}</span>
                        </div>
                      )}
                      {(totals.discount_amount ?? 0) > 0 && (
                        <div className="flex justify-between text-green-700">
                          <span>הנחה</span>
                          <span>-{formatILS(totals.discount_amount)}</span>
                        </div>
                      )}
                      {(totals.vat_amount ?? 0) > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>מע״מ {Math.round((totals.vat_rate ?? 0.18) * 100)}%</span>
                          <span>{formatILS(totals.vat_amount)}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between font-bold text-base">
                        <span>סה״כ כולל מע״מ</span>
                        <span className="text-primary">{formatILS(totals.total_with_vat)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Terms */}
              {terms && (
                <div className="rounded-lg border border-gray-200 p-4 space-y-2 text-sm bg-white">
                  <h3 className="font-semibold text-gray-700 mb-3">תנאים</h3>
                  {terms.project_title && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">שם פרויקט</span>
                      <span>{terms.project_title}</span>
                    </div>
                  )}
                  {terms.payment_terms && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">תנאי תשלום</span>
                      <span>{terms.payment_terms}</span>
                    </div>
                  )}
                  {terms.valid_until && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">תוקף עד</span>
                      <span>{formatDate(terms.valid_until)}</span>
                    </div>
                  )}
                  {(terms.deposit_amount ?? 0) > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">מקדמה</span>
                      <span>{formatILS(terms.deposit_amount)}</span>
                    </div>
                  )}
                  {terms.delivery_terms && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">זמן אספקה</span>
                      <span>{terms.delivery_terms}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {notes && (notes.customer_notes || notes.operation_notes || notes.internal_notes) && (
                <div className="rounded-lg border border-gray-200 p-4 space-y-3 bg-white">
                  <h3 className="font-semibold text-gray-700">הערות</h3>
                  {notes.customer_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות ללקוח
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-line bg-blue-50 rounded p-2">
                        {notes.customer_notes}
                      </p>
                    </div>
                  )}
                  {notes.operation_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות לצוות האופרציה
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded p-2">
                        {notes.operation_notes}
                      </p>
                    </div>
                  )}
                  {notes.internal_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות פנימיות
                      </p>
                      <p className="text-sm text-gray-700 whitespace-pre-line bg-gray-50 rounded p-2">
                        {notes.internal_notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Legacy deal content ── */}
          {!isQuoteBased && (
            <div className="space-y-4">
              {deal.what_is_included && (
                <div className="rounded-lg border border-gray-200 p-4 bg-white">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">מה כלול בעסקה</h3>
                  <p className="text-sm text-gray-700 whitespace-pre-line">
                    {deal.what_is_included}
                  </p>
                </div>
              )}

              {/* Legacy numeric details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {deal.studio_hours_remaining != null && (
                  <div className="rounded-lg border border-gray-200 p-3 bg-white">
                    <p className="text-xs text-muted-foreground">שעות סטודיו שנותרו</p>
                    <p className="font-semibold text-gray-900 mt-0.5">
                      {Number(deal.studio_hours_remaining).toLocaleString("he-IL")}
                    </p>
                  </div>
                )}
                {deal.editing_tasks_remaining != null && (
                  <div className="rounded-lg border border-gray-200 p-3 bg-white">
                    <p className="text-xs text-muted-foreground">משימות עריכה שנותרו</p>
                    <p className="font-semibold text-gray-900 mt-0.5">
                      {Number(deal.editing_tasks_remaining).toLocaleString("he-IL")}
                    </p>
                  </div>
                )}
                {deal.quote_link && (
                  <div className="rounded-lg border border-gray-200 p-3 bg-white">
                    <p className="text-xs text-muted-foreground">קישור להצעה</p>
                    <a
                      href={deal.quote_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary underline-offset-4 hover:underline truncate block mt-0.5"
                    >
                      פתח קישור
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Special notes (editable field — shown for both types) */}
          {deal.special_notes && (
            <div className="rounded-lg border border-gray-200 p-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">הערות פנימיות / אופרציה</h3>
              <p className="text-sm text-gray-700 whitespace-pre-line">{deal.special_notes}</p>
            </div>
          )}

          {/* Dates */}
          <div className="rounded-lg border border-gray-200 p-4 bg-white space-y-2 text-sm">
            <h3 className="font-semibold text-gray-700 mb-3">תאריכים</h3>
            {deal.purchase_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">תאריך רכישה</span>
                <span>{formatDate(deal.purchase_date)}</span>
              </div>
            )}
            {deal.next_payment_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">תאריך תשלום הבא</span>
                <span>{formatDate(deal.next_payment_date)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">נוצרה</span>
              <span>{formatDate(deal.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">עדכון אחרון</span>
              <span>{formatDate(deal.updated_at)}</span>
            </div>
          </div>

        </div>
      </div>

      {editOpen && (
        <EditModal
          deal={deal}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["deal", id] })}
        />
      )}
    </Shell>
  );
}
