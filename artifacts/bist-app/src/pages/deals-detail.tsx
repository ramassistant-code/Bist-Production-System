import { useState, useEffect } from "react";
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
import { ChevronRight, Pencil, AlertCircle, Plus, CreditCard, Banknote, ArrowRightLeft, RefreshCw, Settings2, Trash2, Link2, Copy, Check, Loader2 } from "lucide-react";
import DealFormDialog, { type DealEditable } from "@/components/deals/deal-form-dialog";

// ── Types ────────────────────────────────────────────────────────────────────
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  amount_paid: string;                   // ex-VAT (for Monday sync)
  amount_paid_including_vat: string;     // inclusive (for display)
  status: string;
  installments_count: number | null;
  invoice_name: string | null;
  invoice_tax_id: string | null;
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
  salesperson_id: string | null;
  payment_status: string | null;
  execution_status: string;
  purchase_date: string | null;
  next_payment_date: string | null;
  total_amount: string | null;
  total_amount_including_vat: string | null;
  paid_amount: string | null;
  amount_paid_including_vat: string | null;
  remaining_amount: string | null;
  payment_type: string | null;
  installments_count: number | null;
  invoice_name: string | null;
  invoice_id_number: string | null;
  invoice_email: string | null;
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
  "בעבודה",
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
  בעבודה: "default",
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
  "בתהליך":        "bg-secondary text-secondary-foreground",
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
  "הוחזר":          "bg-secondary text-secondary-foreground",
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

// ── Payment link + WhatsApp modal ─────────────────────────────────────────────

interface PaymentLinkResponse {
  payment_url: string;
  clearing_id: string | null;
  amount: number;
  phone: string | null;
  message: string;
  whatsapp_url: string | null;
}

interface PaymentLinkModalProps {
  dealId: string;
  open: boolean;
  onClose: () => void;
}

function PaymentLinkModal({ dealId, open, onClose }: PaymentLinkModalProps) {
  const { toast } = useToast();
  const [data, setData] = useState<PaymentLinkResponse | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<"link" | "msg" | null>(null);

  const mutation = useMutation<PaymentLinkResponse, Error & { data?: { error?: string } }>({
    mutationFn: () =>
      customFetch<PaymentLinkResponse>(`/api/deals/${dealId}/payment-link`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (res) => {
      setData(res);
      setMessage(res.message);
    },
    onError: (err) => {
      toast({ title: err?.data?.error ?? err.message ?? "שגיאה ביצירת לינק תשלום", variant: "destructive" });
    },
  });

  // בעת פתיחת המודאל — יוצרים לינק פעם אחת. בסגירה — מאפסים.
  useEffect(() => {
    if (open && !data && !mutation.isPending) {
      mutation.mutate();
    }
    if (!open) {
      setData(null);
      setMessage("");
      setCopied(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function copy(text: string, which: "link" | "msg") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast({ title: "לא ניתן להעתיק ללוח", variant: "destructive" });
    }
  }

  // בונים מחדש את קישור הוואטסאפ מהטקסט הערוך (כדי שהעריכה תשתקף).
  const waUrl =
    data?.phone && message
      ? `https://web.whatsapp.com/send?phone=${data.phone}&text=${encodeURIComponent(message)}`
      : null;

  function openWhatsApp() {
    if (!waUrl) return;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>לינק תשלום ושליחה בוואטסאפ</DialogTitle>
        </DialogHeader>

        {mutation.isPending ? (
          <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            יוצר לינק תשלום מול Invoice4U…
          </div>
        ) : !data ? (
          <div className="space-y-4 py-6">
            <p className="text-sm text-muted-foreground text-center">לא נוצר לינק תשלום.</p>
            <div className="flex justify-center">
              <Button size="sm" onClick={() => mutation.mutate()}>
                <RefreshCw className="w-3.5 h-3.5 ml-1" />
                נסה שוב
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Payment link */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">לינק לתשלום</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={data.payment_url}
                  dir="ltr"
                  className="w-full h-9 rounded-md border border-input bg-muted/40 px-3 text-sm shadow-sm focus:outline-none"
                />
                <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => copy(data.payment_url, "link")}>
                  {copied === "link" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            {/* Editable message */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">הודעה ללקוח (ניתן לעריכה)</label>
              <p className="text-xs text-muted-foreground">
                מלא/החלף את החלקים ב־<span className="font-mono">[ ]</span> (לינק העברה בנקאית, מה קורה אחרי החתימה) לפני שליחה.
              </p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={16}
                dir="rtl"
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              />
            </div>

            {!data.phone && (
              <p className="flex items-center gap-1.5 text-xs text-amber-500">
                <AlertCircle className="w-3.5 h-3.5" />
                אין מספר טלפון תקין ללקוח — אפשר להעתיק את ההודעה ולשלוח ידנית.
              </p>
            )}
          </div>
        )}

        {data && (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => copy(message, "msg")}>
              {copied === "msg" ? <Check className="w-4 h-4 ml-1" /> : <Copy className="w-4 h-4 ml-1" />}
              העתק הודעה
            </Button>
            <Button onClick={openWhatsApp} disabled={!waUrl} className="bg-[#25D366] hover:bg-[#1fb457] text-white">
              פתח בוואטסאפ
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AddPaymentModalProps {
  dealId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultInvoice?: { name: string; idNumber: string; email: string };
}

function AddPaymentModal({ dealId, open, onClose, onSaved, defaultInvoice }: AddPaymentModalProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [paymentPurpose, setPaymentPurpose] = useState("גבייה");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [installments, setInstallments] = useState("1");
  const [invoiceName, setInvoiceName] = useState(defaultInvoice?.name ?? "");
  const [invoiceIdNumber, setInvoiceIdNumber] = useState(defaultInvoice?.idNumber ?? "");
  const [invoiceEmail, setInvoiceEmail] = useState(defaultInvoice?.email ?? "");
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
          installments_count: paymentType === "credit_card" ? Number(installments) : 1,
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
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>הוספת תשלום</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Amount + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground/70">
                סכום (כולל מע"מ) <span className="text-destructive">*</span>
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
              className="w-full h-9 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm"
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
            <div className="space-y-3 bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-primary font-medium">פרטי חשבונית</p>
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
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת עסקה {deal.deal_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/70">סטטוס ביצוע</label>
            <select
              value={execStatus}
              onChange={(e) => setExecStatus(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm"
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
            <div className="h-9 rounded-md border border-input bg-muted/40 px-3 py-1 text-sm flex items-center text-muted-foreground">
              {deal.payment_status || "— מחושב אוטומטית —"}
            </div>
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
export default function DealsDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [fullEditOpen, setFullEditOpen] = useState(false);
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

  const { data: creditsData, refetch: refetchCredits } = useQuery<{ credits: CreditRow[] }>({
    queryKey: ["deal-credits", id],
    queryFn: () => customFetch<{ credits: CreditRow[] }>(`/api/deals/${id}/credits`),
    enabled: !!id,
    staleTime: 20_000,
  });

  const syncCreditsMutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/deals/${id}/sync-credits`, { method: "POST" }),
    onSuccess: () => void refetchCredits(),
    onError: () => toast({ title: "שגיאה בסנכרון קרדיטים", variant: "destructive" }),
  });

  const { data: mondayData, refetch: refetchMonday, isFetching: mondayFetching } = useQuery<{
    runs: Array<{ id: string; run_number: number; action_type: string; status: string; created_at: string; error_message?: string; created_count?: number; updated_count?: number }>;
    linked_count: number;
  }>({
    queryKey: ["deal-monday-runs", id],
    queryFn: () => customFetch(`/api/monday/deals/${id}/runs`),
    enabled: !!id,
    staleTime: 30_000,
  });

  const mondayRunMutation = useMutation({
    mutationFn: (opts: { actionType?: string; dryRun?: boolean }) =>
      customFetch("/api/monday/runs", {
        method: "POST",
        body: JSON.stringify({ dealId: id, actionType: opts.actionType ?? "start", dryRun: opts.dryRun ?? false }),
      }),
    onSuccess: () => void refetchMonday(),
    onError: (e) => toast({ title: "שגיאה", description: (e as Error).message, variant: "destructive" }),
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
                עריכה מהירה
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFullEditOpen(true)}
              >
                <Settings2 className="w-3.5 h-3.5 ml-1" />
                עריכה מלאה
              </Button>
            </div>
          </div>

          {/* KPI strip */}
          {(() => {
            // Derive VAT rate from snapshot (stored as decimal 0.18 or percent 18)
            const totSnap = (deal.totals_snapshot ?? {}) as Record<string, number>;
            const vatRateRaw = totSnap["vat_rate"] ?? 0.18;
            const vatRateDecimal = vatRateRaw > 1 ? vatRateRaw / 100 : vatRateRaw;

            const paidExVat = Number(deal.paid_amount ?? 0);
            const paidIncVatStored = Number(deal.amount_paid_including_vat ?? 0);
            // Guard: if stored inclusive ≤ ex-VAT (data written before migration or
            // overwritten by a trigger), recompute from ex-VAT × (1 + vat_rate).
            const paidIncVat = paidIncVatStored > paidExVat + 0.005
              ? paidIncVatStored
              : Math.round(paidExVat * (1 + vatRateDecimal) * 100) / 100;

            const totalIncVat = Number(deal.total_amount_including_vat ?? 0);
            const remainingIncVat = Math.max(0,
              Math.round((totalIncVat - paidIncVat) * 100) / 100
            );
            const kpis: Array<{ label: string; value: string; sub?: string }> = [
              { label: "לקוח", value: customerDisplayName },
              {
                label: 'סכום עסקה',
                value: formatILS(deal.total_amount_including_vat),
                sub: `ללא מע"מ: ${formatILS(deal.total_amount)}`,
              },
              {
                label: 'שולם',
                value: formatILS(paidIncVat),
                sub: `ללא מע"מ: ${formatILS(deal.paid_amount)}`,
              },
              {
                label: 'יתרה',
                value: formatILS(remainingIncVat),
                sub: `ללא מע"מ: ${formatILS(deal.remaining_amount)}`,
              },
            ];
            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {kpis.map(({ label, value, sub }) => (
                  <div key={label} className="rounded-lg border border-border p-3 bg-card">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-semibold text-foreground mt-0.5 truncate">{value}</p>
                    {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{sub}</p>}
                  </div>
                ))}
              </div>
            );
          })()}

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
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setAddPaymentOpen(true)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    הוסף תשלום
                  </Button>
                </div>
              )}
            </div>

            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-4">אין תשלומים רשומים לעסקה זו.</p>
            ) : (
              <TooltipProvider delayDuration={200}>
                <div className="divide-y divide-border/50">
                  {payments.map((p) => {
                    const incVat = Number(p.amount_paid_including_vat ?? p.amount_paid ?? 0);
                    const exVat  = Number(p.amount_paid ?? 0);
                    const vatAmt = Math.round((incVat - exVat) * 100) / 100;
                    const hasBreakdown = vatAmt > 0.005;
                    return (
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
                          {hasBreakdown ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="font-semibold text-foreground underline decoration-dotted cursor-help">
                                  {formatILS(incVat)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" dir="rtl">
                                <p className="whitespace-nowrap">
                                  {formatILS(exVat)} + מע״מ {formatILS(vatAmt)} = {formatILS(incVat)}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="font-semibold text-foreground">{formatILS(incVat)}</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PAYMENT_STATUS_STYLE[p.status] ?? "bg-muted text-muted-foreground"}`}>
                            {p.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TooltipProvider>
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
              <button
                onClick={() => syncCreditsMutation.mutate()}
                disabled={syncCreditsMutation.isPending}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                title="סנכרן קרדיטים מה-snapshot"
              >
                {syncCreditsMutation.isPending ? "מסנכרן…" : "סנכרן"}
              </button>
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
                      {c.salesperson_note && (
                        <p className="text-xs text-muted-foreground mt-1 italic">{c.salesperson_note}</p>
                      )}
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
                              <span className="text-muted-foreground">הערה למחלקת אופרציה: </span>
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
                                      <span className="text-primary mr-auto">
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
                      <p className="text-sm text-foreground/70 whitespace-pre-line bg-primary/10 rounded p-2">
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

      <DealFormDialog
        open={fullEditOpen}
        onClose={() => setFullEditOpen(false)}
        deal={deal as DealEditable}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["deal", id] });
          setFullEditOpen(false);
        }}
      />

      {addPaymentOpen && (
        <AddPaymentModal
          dealId={deal.id}
          open={addPaymentOpen}
          onClose={() => setAddPaymentOpen(false)}
          onSaved={() => {
            void refetchPayments();
            queryClient.invalidateQueries({ queryKey: ["deal", id] });
          }}
          defaultInvoice={(() => {
            // מחפש את התשלום הלא-כרטיסי האחרון ולוקח ממנו פרטי חשבונית
            const lastNonCard = [...(paymentsData?.payments ?? [])]
              .reverse()
              .find((p) => p.payment_method !== "credit_card" && p.invoice_name);
            return {
              name: lastNonCard?.invoice_name ?? deal.invoice_name ?? "",
              idNumber:
                lastNonCard?.invoice_tax_id ??
                deal.invoice_id_number ??
                (deal.party_snapshot as { tax_id?: string } | null)?.tax_id ??
                "",
              email: lastNonCard?.invoice_email ?? deal.invoice_email ?? "",
            };
          })()}
        />
      )}
    </Shell>
  );
}
