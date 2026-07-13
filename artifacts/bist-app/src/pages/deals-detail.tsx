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
import { ChevronRight, Pencil, AlertCircle, Plus, CreditCard, Banknote, ArrowRightLeft } from "lucide-react";

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

interface PaymentRow {
  id: string;
  payment_number: string;
  payment_date: string | null;
  payment_method: string | null;
  payment_purpose: string | null;
  amount_paid: string;
  status: string;
  installments_count: number | null;
  invoice_name: string | null;
  invoice_email: string | null;
  source_type: string | null;
  created_at: string;
}

interface CreditRow {
  id: string;
  credit_number: string;
  credit_name: string;
  parent_product_name: string | null;
  description: string | null;
  status: string;
  quantity: string;
  completed_quantity: string;
  remaining_quantity: string | null;
  credit_date: string | null;
  owner_role: string | null;
  salesperson_note: string | null;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const CREDIT_STATUS_STYLE: Record<string, string> = {
  "ממתין":         "bg-muted text-muted-foreground",
  "בתהליך":        "bg-blue-100 text-blue-700",
  "ממתין ללקוח":   "bg-yellow-100 text-yellow-700",
  "בבדיקת איכות": "bg-orange-100 text-orange-700",
  "הושלם":         "bg-green-100 text-green-700",
  "בוטל":          "bg-red-100 text-red-600",
};

const PAYMENT_STATUS_STYLE: Record<string, string> = {
  "התקבל":          "bg-green-100 text-green-700",
  "ממתין לתשלום":   "bg-muted text-muted-foreground",
  "חלקי":           "bg-yellow-100 text-yellow-700",
  "נכשל":           "bg-red-100 text-red-600",
  "הוחזר":          "bg-purple-100 text-purple-700",
  "בוטל":           "bg-red-100 text-red-600",
};

const PAYMENT_METHOD_ICON: Record<string, React.ReactNode> = {
  "אשראי":         <CreditCard className="w-3.5 h-3.5" />,
  "מזומן":         <Banknote className="w-3.5 h-3.5" />,
  "העברה בנקאית": <ArrowRightLeft className="w-3.5 h-3.5" />,
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "מזומן",
  credit_card: "אשראי",
  bank_transfer: "העברה בנקאית",
};

// ── Add Payment Modal ─────────────────────────────────────────────────────────

interface AddPaymentModalProps {
  dealId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function AddPaymentModal({ dealId, open, onClose, onSaved }: AddPaymentModalProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [paymentPurpose, setPaymentPurpose] = useState("גבייה");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [installments, setInstallments] = useState("1");
  const [invoiceName, setInvoiceName] = useState("");
  const [invoiceIdNumber, setInvoiceIdNumber] = useState("");
  const [invoiceEmail, setInvoiceEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    const n = Number(amount);
    if (!amount || isNaN(n) || n <= 0) e.amount = "יש להזין סכום תקין גדול מאפס";
    if (!paymentType) e.paymentType = "יש לבחור אמצעי תשלום";
    if (paymentType === "credit_card") {
      const inst = Number(installments);
      if (!installments || isNaN(inst) || inst < 1 || !Number.isInteger(inst)) {
        e.installments = "יש להזין מספר תשלומים תקין";
      }
    } else if (paymentType) {
      if (!invoiceName.trim()) e.invoiceName = "שדה חובה";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const mutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/deals/${dealId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount_paid: Number(amount),
          payment_type: paymentType,
          payment_purpose: paymentPurpose,
          payment_date: paymentDate,
          installments_count: paymentType === "credit_card" ? Number(installments) : null,
          invoice_name: paymentType !== "credit_card" ? invoiceName : null,
          invoice_id_number: paymentType !== "credit_card" ? invoiceIdNumber : null,
          invoice_email: paymentType !== "credit_card" ? invoiceEmail : null,
        }),
      }),
    onSuccess: () => {
      toast({ title: "תשלום נוסף בהצלחה" });
      onSaved();
      onClose();
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({ title: err?.data?.error ?? "שגיאה בהוספת תשלום", variant: "destructive" });
    },
  });

  function handleSubmit() {
    if (!validate()) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>הוספת תשלום</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Amount + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">
                סכום <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                dir="ltr"
                className={`w-full h-9 rounded-md border px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${errors.amount ? "border-destructive" : "border-input"}`}
              />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">תאריך תשלום</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                dir="ltr"
                className="w-full h-9 rounded-md border border-input px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Payment type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/70">
              אמצעי תשלום <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {(["cash", "credit_card", "bank_transfer"] as const).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPaymentType(pt)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    paymentType === pt
                      ? "bg-primary text-white border-primary"
                      : "bg-card text-foreground/70 border-border hover:border-gray-400"
                  }`}
                >
                  {PAYMENT_LABELS[pt]}
                </button>
              ))}
            </div>
            {errors.paymentType && <p className="text-xs text-destructive">{errors.paymentType}</p>}
          </div>

          {/* Purpose */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/70">מטרת תשלום</label>
            <select
              value={paymentPurpose}
              onChange={(e) => setPaymentPurpose(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            >
              <option value="גבייה">גבייה</option>
              <option value="לקוח חדש">לקוח חדש</option>
              <option value="Upsell">Upsell</option>
            </select>
          </div>

          {/* Credit card — installments */}
          {paymentType === "credit_card" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">
                כמות תשלומים <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                dir="ltr"
                className={`w-24 h-9 rounded-md border px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${errors.installments ? "border-destructive" : "border-input"}`}
              />
              {errors.installments && <p className="text-xs text-destructive">{errors.installments}</p>}
            </div>
          )}

          {/* Cash / bank transfer — invoice details */}
          {paymentType && paymentType !== "credit_card" && (
            <div className="space-y-3 bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-700 font-medium">פרטי חשבונית</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground/70">
                  שם על החשבונית <span className="text-destructive">*</span>
                </label>
                <input
                  value={invoiceName}
                  onChange={(e) => setInvoiceName(e.target.value)}
                  placeholder="שם מלא / שם חברה"
                  className={`w-full h-9 rounded-md border bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 ${errors.invoiceName ? "border-destructive" : "border-input"}`}
                />
                {errors.invoiceName && <p className="text-xs text-destructive">{errors.invoiceName}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground/70">ת.ז / ח.פ</label>
                  <input
                    value={invoiceIdNumber}
                    onChange={(e) => setInvoiceIdNumber(e.target.value)}
                    placeholder="000000000"
                    dir="ltr"
                    className="w-full h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground/70">מייל חשבונית</label>
                  <input
                    type="email"
                    value={invoiceEmail}
                    onChange={(e) => setInvoiceEmail(e.target.value)}
                    placeholder="email@example.com"
                    dir="ltr"
                    className="w-full h-9 rounded-md border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ביטול
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? "שומר..." : "הוסף תשלום"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
            <label className="text-sm font-medium text-foreground/70">סטטוס ביצוע</label>
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
            <label className="text-sm font-medium text-foreground/70">סטטוס תשלום</label>
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
            <label className="text-sm font-medium text-foreground/70">
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

  const [addPaymentOpen, setAddPaymentOpen] = useState(false);

  const { data: deal, isLoading, isError } = useQuery<DealDetail>({
    queryKey: ["deal", id],
    queryFn: () => customFetch<DealDetail>(`/api/deals/${id}`),
    staleTime: 30_000,
  });

  const { data: paymentsData, refetch: refetchPayments } = useQuery<{ payments: PaymentRow[] }>({
    queryKey: ["deal-payments", id],
    queryFn: () => customFetch<{ payments: PaymentRow[] }>(`/api/deals/${id}/payments`),
    enabled: !!id,
    staleTime: 20_000,
  });

  const { data: creditsData } = useQuery<{ credits: CreditRow[] }>({
    queryKey: ["deal-credits", id],
    queryFn: () => customFetch<{ credits: CreditRow[] }>(`/api/deals/${id}/credits`),
    enabled: !!id,
    staleTime: 20_000,
  });

  const payments = paymentsData?.payments ?? [];
  const credits = creditsData?.credits ?? [];

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
              <h1 className="text-xl font-bold text-foreground">{deal.deal_number}</h1>
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
              <div key={label} className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-foreground mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>

          {/* ── Payments section ── */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/50">
              <h3 className="text-sm font-semibold text-foreground/70">
                תשלומים
                {payments.length > 0 && (
                  <span className="mr-1.5 text-xs font-normal text-muted-foreground">({payments.length})</span>
                )}
              </h3>
              {deal.execution_status !== "בוטלה" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setAddPaymentOpen(true)}
                >
                  <Plus className="w-3.5 h-3.5" />
                  הוסף תשלום
                </Button>
              )}
            </div>

            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-4">אין תשלומים רשומים לעסקה זו.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground font-mono shrink-0">{p.payment_number}</span>
                      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
                        {p.payment_method && PAYMENT_METHOD_ICON[p.payment_method]}
                        <span className="text-xs">{p.payment_method ?? "—"}</span>
                      </div>
                      {p.payment_purpose && (
                        <span className="text-xs text-muted-foreground hidden sm:inline">{p.payment_purpose}</span>
                      )}
                      {p.invoice_name && (
                        <span className="text-xs text-muted-foreground truncate hidden md:inline">/ {p.invoice_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 mr-4">
                      <span className="text-xs text-muted-foreground">
                        {p.payment_date ? formatDate(p.payment_date) : "—"}
                      </span>
                      <span className="font-semibold text-foreground">{formatILS(p.amount_paid)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAYMENT_STATUS_STYLE[p.status] ?? "bg-muted text-muted-foreground"}`}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Credits section ── */}
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/50">
              <h3 className="text-sm font-semibold text-foreground/70">
                קרדיטים
                {credits.length > 0 && (
                  <span className="mr-1.5 text-xs font-normal text-muted-foreground">({credits.length})</span>
                )}
              </h3>
            </div>

            {credits.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-4">אין קרדיטים לעסקה זו.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {credits.map((c) => {
                  const qty = Number(c.quantity);
                  const done = Number(c.completed_quantity);
                  const pct = qty > 0 ? Math.min(100, Math.round((done / qty) * 100)) : 0;
                  return (
                    <div key={c.id} className="px-4 py-2.5 hover:bg-muted/50/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono shrink-0">{c.credit_number}</span>
                            <span className="text-sm font-medium text-foreground/80 truncate">{c.credit_name}</span>
                          </div>
                          {c.parent_product_name && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.parent_product_name}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {done}/{qty}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CREDIT_STATUS_STYLE[c.status] ?? "bg-muted text-muted-foreground"}`}>
                            {c.status}
                          </span>
                        </div>
                      </div>
                      {qty > 0 && (
                        <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Source badge */}
          {!isQuoteBased && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-4 py-2">
              <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />
              עסקה ממוקד ייבוא היסטורי (Monday.com) — אין נתוני הצעת מקור
            </div>
          )}

          {/* ── Quote-based deal content ── */}
          {isQuoteBased && (
            <>
              {/* Party info from snapshot */}
              {party && (
                <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
                  <h3 className="text-sm font-semibold text-foreground/70">פרטי לקוח (מהצעת המחיר)</h3>
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
                  <h3 className="text-sm font-semibold text-foreground/70">סל מוצרים</h3>
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-card overflow-hidden"
                    >
                      <div className="flex items-start justify-between px-4 py-3 bg-muted/50 border-b border-border/50">
                        <div>
                          <p className="font-medium text-foreground">
                            {item.product_name_snapshot}
                          </p>
                          {item.product_description_snapshot && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {item.product_description_snapshot}
                            </p>
                          )}
                        </div>
                        <div className="text-left shrink-0 mr-3">
                          <p className="font-bold text-foreground/80">
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
                              <span className="text-muted-foreground">הערכה למחלקת אופרציה: </span>
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
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                {item.components_snapshot.length} רכיבים:
                              </p>
                              <div className="space-y-1">
                                {item.components_snapshot.map((c, ci) => (
                                  <div
                                    key={ci}
                                    className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1"
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
                    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1.5 text-sm">
                      {(totals.subtotal_before_discount ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">סה״כ לפני הנחה</span>
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
                        <div className="flex justify-between text-muted-foreground">
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
                <div className="rounded-lg border border-border p-4 space-y-2 text-sm bg-card">
                  <h3 className="font-semibold text-foreground/70 mb-3">תנאים</h3>
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
                <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
                  <h3 className="font-semibold text-foreground/70">הערות</h3>
                  {notes.customer_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות ללקוח
                      </p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-blue-50 rounded p-2">
                        {notes.customer_notes}
                      </p>
                    </div>
                  )}
                  {notes.operation_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות לצוות האופרציה
                      </p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-muted/50 rounded p-2">
                        {notes.operation_notes}
                      </p>
                    </div>
                  )}
                  {notes.internal_notes && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        הערות פנימיות
                      </p>
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-muted/50 rounded p-2">
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
                <div className="rounded-lg border border-border p-4 bg-card">
                  <h3 className="text-sm font-semibold text-foreground/70 mb-2">מה כלול בעסקה</h3>
                  <p className="text-sm text-foreground/70 whitespace-pre-line">
                    {deal.what_is_included}
                  </p>
                </div>
              )}

              {/* Legacy numeric details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {deal.studio_hours_remaining != null && (
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">שעות סטודיו שנותרו</p>
                    <p className="font-semibold text-foreground mt-0.5">
                      {Number(deal.studio_hours_remaining).toLocaleString("he-IL")}
                    </p>
                  </div>
                )}
                {deal.editing_tasks_remaining != null && (
                  <div className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">משימות עריכה שנותרו</p>
                    <p className="font-semibold text-foreground mt-0.5">
                      {Number(deal.editing_tasks_remaining).toLocaleString("he-IL")}
                    </p>
                  </div>
                )}
                {deal.quote_link && (
                  <div className="rounded-lg border border-border p-3 bg-card">
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
            <div className="rounded-lg border border-border p-4 bg-card">
              <h3 className="text-sm font-semibold text-foreground/70 mb-2">הערות פנימיות / אופרציה</h3>
              <p className="text-sm text-foreground/70 whitespace-pre-line">{deal.special_notes}</p>
            </div>
          )}

          {/* Dates */}
          <div className="rounded-lg border border-border p-4 bg-card space-y-2 text-sm">
            <h3 className="font-semibold text-foreground/70 mb-3">תאריכים</h3>
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

      {addPaymentOpen && (
        <AddPaymentModal
          dealId={deal.id}
          open={addPaymentOpen}
          onClose={() => setAddPaymentOpen(false)}
          onSaved={() => {
            void refetchPayments();
            queryClient.invalidateQueries({ queryKey: ["deal", id] });
          }}
        />
      )}
    </Shell>
  );
}
