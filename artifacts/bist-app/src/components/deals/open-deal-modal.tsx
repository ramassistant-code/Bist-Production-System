import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────

interface PartySnapshot {
  party_type?: "customer" | "lead";
  business_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
}

interface TotalsSnapshot {
  total_with_vat?: number;
}

interface QuoteVersion {
  id: string;
  status: string;
  locked_at: string | null;
  party_snapshot: PartySnapshot | null;
  totals_snapshot: TotalsSnapshot | null;
}

interface QuoteRow {
  id: string;
  quote_number: string;
  customer_id: string | null;
  lead_id: string | null;
  customer_name?: string;
  customer_phone?: string;
  lead_name?: string;
  lead_phone?: string;
}

interface AppUser {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
}

interface CoordinationTask {
  task_text: string;
  assignee_role: string;
}

interface CustomerBilling {
  invoice_name: string | null;
  tax_id: string | null;
  invoice_email: string | null;
}

interface OpenDealModalProps {
  quote: QuoteRow;
  version: QuoteVersion;
  currentUser: { id: string; full_name?: string | null; email: string } | null;
  onClose: () => void;
  onSuccess: (dealId: string, dealNumber: string) => void;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "מזומן",
  credit_card: "אשראי",
  bank_transfer: "העברה בנקאית",
};

const ASSIGNEE_LABELS: Record<string, string> = {
  editing_operations: "עריכות ואופרציה",
  sales: "מכירות",
  office_manager: "מנהלת משרד",
};

function formatILS(n: number | null | undefined) {
  if (n == null) return "—";
  return `₪${Number(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function OpenDealModal({ quote, version, currentUser, onClose, onSuccess }: OpenDealModalProps) {
  const { toast } = useToast();
  const party = version.party_snapshot;
  const totalsSnap = version.totals_snapshot;
  const totalWithVat = totalsSnap?.total_with_vat ?? 0;
  const isLead = !!quote.lead_id && !quote.customer_id;

  // ── Lead editable fields ────────────────────────────────────────────────
  const [leadName, setLeadName] = useState(party?.contact_name ?? quote.lead_name ?? "");
  const [leadBusiness, setLeadBusiness] = useState(party?.business_name ?? "");
  const [leadPhone, setLeadPhone] = useState(party?.phone ?? quote.lead_phone ?? "");
  const [leadEmail, setLeadEmail] = useState(party?.email ?? "");
  const [leadTaxId, setLeadTaxId] = useState(party?.tax_id ?? "");

  // ── Salesperson ─────────────────────────────────────────────────────────
  const [salespersonId, setSalespersonId] = useState("");

  // ── Financial ───────────────────────────────────────────────────────────
  const [amountPaid, setAmountPaid] = useState("0");

  // ── Payment type ────────────────────────────────────────────────────────
  const [paymentType, setPaymentType] = useState("");
  const [installments, setInstallments] = useState("1");
  const [invoiceName, setInvoiceName] = useState("");
  const [invoiceIdNumber, setInvoiceIdNumber] = useState("");
  const [invoiceEmail, setInvoiceEmail] = useState("");

  // ── Coordination tasks ──────────────────────────────────────────────────
  const [coordRequested, setCoordRequested] = useState(false);
  const [tasks, setTasks] = useState<CoordinationTask[]>([{ task_text: "", assignee_role: "" }]);

  // ── Operation notes ─────────────────────────────────────────────────────
  const [operationNotes, setOperationNotes] = useState("");

  // ── Validation errors ───────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // ── Load users ──────────────────────────────────────────────────────────
  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: () => customFetch<AppUser[]>("/api/users"),
    staleTime: 60_000,
  });

  // ── Load customer billing defaults (existing customers only) ────────────
  const { data: customerBilling } = useQuery<CustomerBilling>({
    queryKey: ["customer-billing", quote.customer_id],
    queryFn: () => customFetch<CustomerBilling>(`/api/customers/${quote.customer_id}`),
    enabled: !!quote.customer_id,
    staleTime: 30_000,
  });

  // Pre-populate invoice fields from customer billing data
  useEffect(() => {
    if (!customerBilling) return;
    if (customerBilling.invoice_name) setInvoiceName(customerBilling.invoice_name);
    if (customerBilling.tax_id) setInvoiceIdNumber(customerBilling.tax_id);
    if (customerBilling.invoice_email) setInvoiceEmail(customerBilling.invoice_email);
  }, [customerBilling]);

  // Set default salesperson to current user — only after users list is loaded
  useEffect(() => {
    if (currentUser?.id && !salespersonId && users.some(u => u.id === currentUser.id)) {
      setSalespersonId(currentUser.id);
    }
  }, [currentUser?.id, users]);

  // ── Task helpers ────────────────────────────────────────────────────────
  function addTask() {
    setTasks(prev => [...prev, { task_text: "", assignee_role: "" }]);
  }

  function removeTask(index: number) {
    setTasks(prev => prev.filter((_, i) => i !== index));
  }

  function updateTask(index: number, field: keyof CoordinationTask, value: string) {
    setTasks(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t));
  }

  // ── Validation ──────────────────────────────────────────────────────────
  function validate(): boolean {
    const e: Record<string, string> = {};

    // A deal must always be linked to a customer or a resolvable lead
    if (!quote.customer_id && !quote.lead_id) {
      e.party = "הצעה זו אינה מקושרת ללקוח או ליד — לא ניתן לפתוח עסקה. יש לעדכן את ההצעה תחילה.";
    }

    if (isLead && !leadName.trim()) e.leadName = "שם הוא שדה חובה";
    if (!salespersonId) e.salesperson = "יש לבחור איש מכירות";

    const paid = Number(amountPaid);
    if (amountPaid === "" || isNaN(paid) || paid < 0) {
      e.amountPaid = "יש להזין סכום ששולם תקין";
    } else if (paid > totalWithVat) {
      e.amountPaid = "סכום ששולם לא יכול להיות גבוה מסך העסקה";
    }

    if (!paymentType) {
      e.paymentType = "יש לבחור סוג תשלום";
    } else if (paymentType === "credit_card") {
      const inst = Number(installments);
      if (!installments || isNaN(inst) || inst < 1 || !Number.isInteger(inst)) {
        e.installments = "יש להזין מספר תשלומים תקין";
      }
    } else {
      if (!invoiceName.trim()) e.invoiceName = "שדה חובה";
      if (!invoiceIdNumber.trim()) e.invoiceIdNumber = "שדה חובה";
      if (!invoiceEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail)) {
        e.invoiceEmail = "יש להזין מייל תקין";
      }
    }

    if (coordRequested) {
      if (tasks.length === 0) {
        e.tasks = "יש להוסיף לפחות משימה אחת";
      } else {
        tasks.forEach((t, i) => {
          if (!t.task_text.trim()) e[`task_text_${i}`] = "שדה חובה";
          if (!t.assignee_role) e[`task_role_${i}`] = "שדה חובה";
        });
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await customFetch<{
        success: boolean;
        alreadyExists: boolean;
        dealId: string;
        deal_number: string;
        customerId: string | null;
      }>("/api/deals", {
        method: "POST",
        body: JSON.stringify({
          source_quote_version_id: version.id,
          salesperson_user_id: salespersonId,
          amount_paid_including_vat: Number(amountPaid),
          payment_type: paymentType,
          installments_count: paymentType === "credit_card" ? Number(installments) : null,
          invoice_name: paymentType !== "credit_card" ? invoiceName : null,
          invoice_id_number: paymentType !== "credit_card" ? invoiceIdNumber : null,
          invoice_email: paymentType !== "credit_card" ? invoiceEmail : null,
          coordination_tasks_requested: coordRequested,
          coordination_tasks: coordRequested ? tasks : [],
          operation_notes: operationNotes || null,
          ...(isLead ? {
            lead_name: leadName,
            lead_phone: leadPhone,
            lead_email: leadEmail,
            lead_tax_id: leadTaxId,
          } : {}),
        }),
      });
      toast({ title: "מסנכרן עם המערכת...", description: "הנתונים מועברים ברקע", duration: 3000 });
      onSuccess(result.dealId, result.deal_number);
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      setSubmitError(e?.data?.error ?? e?.message ?? "שגיאה פנימית");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      dir="rtl"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-card rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <h2 className="text-xl font-bold tracking-tight text-foreground">פתיחת עסקה</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-80 hover:bg-accent hover:opacity-100 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="סגור"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">

          {/* ─── Guard: no party linked ──────────────────────────────────── */}
          {!quote.customer_id && !quote.lead_id && (
            <div className="bg-destructive/10 border border-red-300 rounded-lg px-4 py-3 text-sm text-red-700">
              ⚠️ הצעה זו אינה מקושרת ללקוח או ליד. יש לעדכן את ההצעה לפני פתיחת עסקה.
            </div>
          )}

          {/* ─── Section 1: פרטי לקוח / ליד ─────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground/70">פרטי לקוח / ליד</h3>
              <Badge variant={isLead ? "secondary" : "outline"} className="text-xs">
                {isLead ? "ליד" : "לקוח קיים"}
              </Badge>
            </div>
            {isLead ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">שם לקוח / ליד <span className="text-red-500">*</span></label>
                  <input
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.leadName ? "border-red-400" : "border-border"}`}
                    value={leadName}
                    onChange={e => setLeadName(e.target.value)}
                    placeholder="שם מלא"
                  />
                  {errors.leadName && <p className="text-xs text-red-500 mt-0.5">{errors.leadName}</p>}
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">שם עסק</label>
                  <input
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={leadBusiness}
                    onChange={e => setLeadBusiness(e.target.value)}
                    placeholder="שם עסק (אם רלוונטי)"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">טלפון</label>
                  <input
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={leadPhone}
                    onChange={e => setLeadPhone(e.target.value)}
                    placeholder="050-0000000"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">מייל</label>
                  <input
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={leadEmail}
                    onChange={e => setLeadEmail(e.target.value)}
                    placeholder="email@example.com"
                    dir="ltr"
                    type="email"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ח.פ / ת.ז</label>
                  <input
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={leadTaxId}
                    onChange={e => setLeadTaxId(e.target.value)}
                    placeholder="אם קיים"
                    dir="ltr"
                  />
                </div>
              </div>
            ) : (
              <div className="bg-muted/50 rounded-lg px-4 py-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">שם:</span>
                  <span className="font-medium">{party?.business_name || party?.contact_name || quote.customer_name || "—"}</span>
                </div>
                {(party?.phone || quote.customer_phone) && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">טלפון:</span>
                    <span dir="ltr">{party?.phone || quote.customer_phone}</span>
                  </div>
                )}
                {party?.email && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">מייל:</span>
                    <span dir="ltr">{party.email}</span>
                  </div>
                )}
                {party?.tax_id && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">ח.פ / ת.ז:</span>
                    <span dir="ltr">{party.tax_id}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">פרטי לקוח קיים — לא ניתן לעריכה</p>
              </div>
            )}
          </section>

          {/* ─── Section 2: איש מכירות ────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground/70 mb-3">איש מכירות</h3>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">איש מכירות <span className="text-red-500">*</span></label>
              <select
                className={`w-full border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.salesperson ? "border-red-400" : "border-border"}`}
                value={salespersonId}
                onChange={e => setSalespersonId(e.target.value)}
              >
                <option value="">— בחר איש מכירות —</option>
                {users.filter(u => u.id && u.role === "sales").map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                    {u.id === currentUser?.id ? " (אתה)" : ""}
                  </option>
                ))}
              </select>
              {errors.salesperson && <p className="text-xs text-red-500 mt-0.5">{errors.salesperson}</p>}
            </div>
          </section>

          {/* ─── Section 3: סיכום כספי ────────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground/70 mb-3">סיכום כספי</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">סה"כ לתשלום כולל מע"מ</label>
                <div className="bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm font-semibold text-foreground/80">
                  {formatILS(totalWithVat)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">מחושב מגרסת ההצעה — לא ניתן לשינוי</p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">סכום ששולם כולל מע"מ <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.amountPaid ? "border-red-400" : "border-border"}`}
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                  placeholder="0"
                  dir="ltr"
                />
                {errors.amountPaid && <p className="text-xs text-red-500 mt-0.5">{errors.amountPaid}</p>}
              </div>
            </div>
          </section>

          {/* ─── Section 4: אמצעי תשלום ───────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground/70 mb-3">אמצעי תשלום</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">סוג תשלום <span className="text-red-500">*</span></label>
                <div className="flex gap-2 flex-wrap">
                  {["cash", "credit_card", "bank_transfer"].map(pt => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPaymentType(pt)}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                        paymentType === pt
                          ? "bg-primary text-white border-primary"
                          : "bg-card text-foreground/70 border-border hover:border-border"
                      }`}
                    >
                      {PAYMENT_LABELS[pt]}
                    </button>
                  ))}
                </div>
                {errors.paymentType && <p className="text-xs text-red-500 mt-1">{errors.paymentType}</p>}
              </div>

              {paymentType === "credit_card" && (
                <div className="w-40">
                  <label className="block text-xs text-muted-foreground mb-1">כמות תשלומים <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    min="1"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors.installments ? "border-red-400" : "border-border"}`}
                    value={installments}
                    onChange={e => setInstallments(e.target.value)}
                    dir="ltr"
                  />
                  {errors.installments && <p className="text-xs text-red-500 mt-0.5">{errors.installments}</p>}
                </div>
              )}

              {paymentType && paymentType !== "credit_card" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-primary/10 rounded-lg p-4">
                  <div className="col-span-full flex items-center justify-between">
                    <p className="text-xs text-primary font-medium">פרטי חשבונית</p>
                    {customerBilling && (customerBilling.invoice_name || customerBilling.tax_id || customerBilling.invoice_email) && (
                      <span className="text-xs text-primary bg-primary/20 px-2 py-0.5 rounded-full">מולא מנתוני הלקוח — ניתן לעדכן</span>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">שם על החשבונית <span className="text-red-500">*</span></label>
                    <input
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-card ${errors.invoiceName ? "border-red-400" : "border-border"}`}
                      value={invoiceName}
                      onChange={e => setInvoiceName(e.target.value)}
                      placeholder="שם מלא / שם חברה"
                    />
                    {errors.invoiceName && <p className="text-xs text-red-500 mt-0.5">{errors.invoiceName}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">מספר ת.ז / ח.פ <span className="text-red-500">*</span></label>
                    <input
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-card ${errors.invoiceIdNumber ? "border-red-400" : "border-border"}`}
                      value={invoiceIdNumber}
                      onChange={e => setInvoiceIdNumber(e.target.value)}
                      placeholder="000000000"
                      dir="ltr"
                    />
                    {errors.invoiceIdNumber && <p className="text-xs text-red-500 mt-0.5">{errors.invoiceIdNumber}</p>}
                  </div>
                  <div className="col-span-full">
                    <label className="block text-xs text-muted-foreground mb-1">מייל לשליחת החשבונית <span className="text-red-500">*</span></label>
                    <input
                      type="email"
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-card ${errors.invoiceEmail ? "border-red-400" : "border-border"}`}
                      value={invoiceEmail}
                      onChange={e => setInvoiceEmail(e.target.value)}
                      placeholder="email@example.com"
                      dir="ltr"
                    />
                    {errors.invoiceEmail && <p className="text-xs text-red-500 mt-0.5">{errors.invoiceEmail}</p>}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ─── Section 5: משימות מיוחדות ────────────────────────────────── */}
          <section>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                checked={coordRequested}
                onChange={e => setCoordRequested(e.target.checked)}
              />
              <span className="text-sm font-semibold text-foreground/70 group-hover:text-foreground">
                פתיחת משימות מיוחדות לתיאום
              </span>
            </label>

            {coordRequested && (
              <div className="mt-4 space-y-3">
                {errors.tasks && <p className="text-xs text-red-500">{errors.tasks}</p>}
                {tasks.map((task, i) => (
                  <div key={i} className="flex gap-2 items-start bg-muted/50 rounded-lg p-3">
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">טקסט משימה <span className="text-red-500">*</span></label>
                        <input
                          className={`w-full border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors[`task_text_${i}`] ? "border-red-400" : "border-border"}`}
                          value={task.task_text}
                          onChange={e => updateTask(i, "task_text", e.target.value)}
                          placeholder="תיאור המשימה"
                        />
                        {errors[`task_text_${i}`] && <p className="text-xs text-red-500 mt-0.5">{errors[`task_text_${i}`]}</p>}
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">אחראי <span className="text-red-500">*</span></label>
                        <select
                          className={`w-full border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40 ${errors[`task_role_${i}`] ? "border-red-400" : "border-border"}`}
                          value={task.assignee_role}
                          onChange={e => updateTask(i, "assignee_role", e.target.value)}
                        >
                          <option value="">— בחר אחראי —</option>
                          {Object.entries(ASSIGNEE_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                        {errors[`task_role_${i}`] && <p className="text-xs text-red-500 mt-0.5">{errors[`task_role_${i}`]}</p>}
                      </div>
                    </div>
                    {tasks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTask(i)}
                        className="text-red-400 hover:text-red-600 mt-6 shrink-0"
                        aria-label="הסר משימה"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addTask} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  הוסף משימה
                </Button>
              </div>
            )}
          </section>

          {/* ─── Section 6: הערות פנימיות ─────────────────────────────────── */}
          <section>
            <h3 className="text-sm font-semibold text-foreground/70 mb-2">הערות לאופרציה</h3>
            <textarea
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              rows={3}
              value={operationNotes}
              onChange={e => setOperationNotes(e.target.value)}
              placeholder="הערות פנימיות לצוות (אופציונלי)"
            />
          </section>

          {/* Submit error */}
          {submitError && (
            <div className="bg-destructive/10 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-muted/50 rounded-b-xl">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-green-600 hover:bg-green-700 text-white px-6"
          >
            {submitting ? "פותח עסקה..." : "אישור פתיחת עסקה"}
          </Button>
        </div>
      </div>
    </div>
  );
}
