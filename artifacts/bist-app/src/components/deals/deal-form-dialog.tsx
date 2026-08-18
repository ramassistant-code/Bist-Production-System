import { useCallback, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X, Plus, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxField, type ComboboxOption } from "@/components/ui/combobox-field";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXECUTION_STATUSES = ["פתוחה", "ממתינה לתיאום", "בעבודה", "הושלמה", "בוטלה"];
const PAYMENT_STATUSES   = ["ממתינה לתשלום", "תשלום חלקי", "שולמה במלואה", "בוטלה"];
const PAYMENT_TYPES = [
  { value: "credit_card",    label: "אשראי" },
  { value: "cash",           label: "מזומן" },
  { value: "bank_transfer",  label: "העברה בנקאית" },
];

const VAT_RATE = 0.18;

function fmtILS(v: string | number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Line item (products without a quote) ─────────────────────────────────────

interface LineItem {
  _key: string;           // local-only row key
  product_id: string | null;
  product_name: string;
  unit_price: string;
  quantity: string;
}

function newLine(): LineItem {
  return { _key: crypto.randomUUID(), product_id: null, product_name: "", unit_price: "", quantity: "1" };
}

function lineTotal(item: LineItem): number {
  const q = Number(item.quantity) || 0;
  const p = Number(item.unit_price) || 0;
  return Math.round(q * p * 100) / 100;
}

// ── Zod schema ────────────────────────────────────────────────────────────────

const uuidOrNull = z.string().regex(UUID_RE).nullable().optional();
const strOrNull  = z.string().nullable().optional();

const dealSchema = z.object({
  customer_id:        uuidOrNull,
  lead_id:            uuidOrNull,
  salesperson_id:     uuidOrNull,
  quote_id:           uuidOrNull,
  execution_status:   z.string().min(1, "שדה חובה"),
  payment_status:     strOrNull,
  payment_type:       strOrNull,
  installments_count: strOrNull,
  purchase_date:      strOrNull,
  next_payment_date:  strOrNull,
  invoice_name:       strOrNull,
  invoice_id_number:  strOrNull,
  invoice_email:      strOrNull,
  what_is_included:   strOrNull,
  special_notes:      strOrNull,
});

type DealFormValues = z.infer<typeof dealSchema>;

export interface DealEditable {
  id: string;
  deal_number: string;
  customer_id: string | null;
  lead_id: string | null;
  salesperson_id: string | null;
  quote_id: string | null;
  payment_status: string | null;
  execution_status: string;
  purchase_date: string | null;
  next_payment_date: string | null;
  payment_type: string | null;
  installments_count: number | null;
  invoice_name: string | null;
  invoice_id_number: string | null;
  invoice_email: string | null;
  what_is_included: string | null;
  special_notes: string | null;
  total_amount: string | null;
  total_amount_including_vat: string | null;
  paid_amount: string | null;
  amount_paid_including_vat: string | null;
  remaining_amount: string | null;
  studio_hours_remaining: string | null;
  editing_tasks_remaining: string | null;
}

interface DealFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (dealId?: string) => void;
  deal?: DealEditable | null;
}

function toFormValues(d?: DealEditable | null): DealFormValues {
  return {
    customer_id:        d?.customer_id       ?? null,
    lead_id:            d?.lead_id           ?? null,
    salesperson_id:     d?.salesperson_id    ?? null,
    quote_id:           d?.quote_id          ?? null,
    execution_status:   d?.execution_status  ?? "פתוחה",
    payment_status:     d?.payment_status    ?? null,
    payment_type:       d?.payment_type      ?? null,
    installments_count: d?.installments_count != null ? String(d.installments_count) : "",
    purchase_date:      d?.purchase_date     ?? "",
    next_payment_date:  d?.next_payment_date ?? "",
    invoice_name:       d?.invoice_name      ?? "",
    invoice_id_number:  d?.invoice_id_number ?? "",
    invoice_email:      d?.invoice_email     ?? "",
    what_is_included:   d?.what_is_included  ?? "",
    special_notes:      d?.special_notes     ?? "",
  };
}

function sanitize(v: DealFormValues): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === "" || val === undefined) r[k] = null;
    else if (k === "installments_count" && val !== null) r[k] = Number(val);
    else r[k] = val;
  }
  return r;
}

export default function DealFormDialog({ open, onClose, onSuccess, deal }: DealFormDialogProps) {
  const isEdit = !!deal;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── Line items (create mode only) ─────────────────────────────────────────
  const [lines, setLines] = useState<LineItem[]>([newLine()]);

  const totalExVat  = lines.reduce((s, l) => s + lineTotal(l), 0);
  const vatAmount   = Math.round(totalExVat * VAT_RATE * 100) / 100;
  const totalIncVat = Math.round((totalExVat + vatAmount) * 100) / 100;

  const {
    control, register, handleSubmit, watch,
    formState: { errors },
  } = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: toFormValues(deal),
  });

  const paymentType = watch("payment_type");

  const mutation = useMutation({
    mutationFn: async (values: DealFormValues) => {
      const patch = sanitize(values);
      if (isEdit) {
        const updated = await apiFetch<{ success: boolean }>(`/api/deals/${deal!.id}`, {
          method: "PATCH",
          body: patch,
        });
        if (!updated.success) throw new Error("שגיאה בעדכון");
        return { id: deal!.id };
      } else {
        // Include items_snapshot and totals when products are specified
        const hasItems = lines.some(l => l.product_id || l.product_name.trim());
        const itemsSnapshot = hasItems
          ? lines
              .filter(l => l.product_id || l.product_name.trim())
              .map((l, i) => ({
                line_id: `line_${i + 1}`,
                product_id: l.product_id,
                product_name_snapshot: l.product_name,
                quantity: Number(l.quantity) || 1,
                unit_price: Number(l.unit_price) || 0,
                line_total: lineTotal(l),
                components_snapshot: [],
              }))
          : null;

        const created = await apiFetch<{ id: string }>("/api/deals/standalone", {
          method: "POST",
          body: {
            ...patch,
            ...(itemsSnapshot
              ? {
                  items_snapshot: itemsSnapshot,
                  total_amount: String(totalExVat),
                  total_amount_including_vat: String(totalIncVat),
                }
              : {}),
          },
        });
        return { id: created.id };
      }
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", id] });
      toast({ title: isEdit ? "העסקה עודכנה בהצלחה" : "העסקה נוצרה בהצלחה" });
      if (!isEdit) toast({ title: "מסנכרן עם המערכת...", description: "הנתונים מועברים ברקע", duration: 3000 });
      if (onSuccess) onSuccess(id);
      else if (!isEdit) navigate(`/deals/${id}`);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: err.message || "שגיאה בשמירת העסקה", variant: "destructive" });
    },
  });

  // ── Combo fetch: customers via API (not Supabase — anon key lacks RLS access) ──

  const fetchCustomers = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = term ? `?search=${encodeURIComponent(term)}` : "";
    const data = await apiFetch<Array<{ id: string; name: string }>>(`/api/customers${qs}`);
    return data.slice(0, 50).map(c => ({ id: c.id, label: c.name }));
  }, []);

  const fetchCustomerById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    try {
      const c = await apiFetch<{ id: string; name: string }>(`/api/customers/${id}`);
      return { id: c.id, label: c.name };
    } catch { return null; }
  }, []);

  // ── Combo fetch: leads via API ───────────────────────────────────────────────

  const fetchLeads = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = term ? `?search=${encodeURIComponent(term)}&limit=50` : "?limit=50";
    const data = await apiFetch<Array<{ id: string; name: string }>>(`/api/leads${qs}`);
    return data.map(l => ({ id: l.id, label: l.name }));
  }, []);

  const fetchLeadById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    try {
      const l = await apiFetch<{ id: string; name: string }>(`/api/leads/${id}`);
      return { id: l.id, label: l.name };
    } catch { return null; }
  }, []);

  // ── Combo fetch: salespersons via API ────────────────────────────────────────

  const fetchSalespersons = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null; is_active: boolean; role: string | null }>>("/api/users");
    return users
      .filter(u => u.is_active && (u.role === "מכירות" || u.role === "מנהל" || u.role === "sales" || u.role === "admin") && (!term || (u.full_name ?? "").toLowerCase().includes(term.toLowerCase())))
      .map(u => ({ id: u.id, label: u.full_name ?? u.id }))
      .slice(0, 50);
  }, []);

  const fetchSalespersonById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null; role: string | null }>>("/api/users");
    const u = users.find(u => u.id === id);
    return u ? { id: u.id, label: u.full_name ?? u.id } : null;
  }, []);

  // ── Combo fetch: quotes via API ──────────────────────────────────────────────

  const fetchQuotes = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = term ? `?search=${encodeURIComponent(term)}&limit=50` : "?limit=50";
    const data = await apiFetch<Array<{ id: string; quote_number: string; customer_name?: string; lead_name?: string }>>(`/api/quotes${qs}`);
    return data.map(q => ({
      id: q.id,
      label: `${q.quote_number}${q.customer_name ? ` — ${q.customer_name}` : q.lead_name ? ` — ${q.lead_name}` : ""}`,
    }));
  }, []);

  const fetchQuoteById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    try {
      const q = await apiFetch<{ id: string; quote_number: string; customer_name?: string; lead_name?: string }>(`/api/quotes/${id}`);
      return {
        id: q.id,
        label: `${q.quote_number}${q.customer_name ? ` — ${q.customer_name}` : q.lead_name ? ` — ${q.lead_name}` : ""}`,
      };
    } catch { return null; }
  }, []);

  // ── Combo fetch: products via API ────────────────────────────────────────────

  const fetchProducts = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = `?is_active=true${term ? `&search=${encodeURIComponent(term)}` : ""}`;
    const data = await apiFetch<Array<{ id: string; name: string; consumer_price?: string | null }>>(`/api/products${qs}`);
    return data.map(p => ({
      id: p.id,
      label: p.name + (p.consumer_price ? ` (₪${Number(p.consumer_price).toLocaleString("he-IL")})` : ""),
    }));
  }, []);

  // ── Line item helpers ────────────────────────────────────────────────────────

  function updateLine(key: string, patch: Partial<Omit<LineItem, "_key">>) {
    setLines(prev => prev.map(l => l._key === key ? { ...l, ...patch } : l));
  }

  async function selectProduct(key: string, productId: string | null, label: string) {
    if (!productId) { updateLine(key, { product_id: null, product_name: "" }); return; }
    // Extract name without price suffix "(₪X)"
    const name = label.replace(/\s*\(₪[\d,]+\)\s*$/, "").trim();
    // Fetch real consumer_price
    try {
      const p = await apiFetch<{ id: string; consumer_price?: string | null }>(`/api/products/${productId}`);
      updateLine(key, {
        product_id: productId,
        product_name: name,
        unit_price: p.consumer_price ? String(Number(p.consumer_price)) : "",
      });
    } catch {
      updateLine(key, { product_id: productId, product_name: name });
    }
  }

  const isBusy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 [&>button:last-child]:hidden" dir="rtl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-bold leading-tight tracking-tight">
            {isEdit ? `עריכת עסקה — ${deal!.deal_number}` : "עסקה חדשה"}
          </DialogTitle>
          <DialogClose asChild>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-80 hover:bg-accent hover:opacity-100 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">סגור</span>
            </button>
          </DialogClose>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-6 pt-1">

          {/* ─── מקושרים ──────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-3">מקושרים</p>
            <div className="grid grid-cols-2 gap-4">

              <div className="space-y-1">
                <Label>לקוח</Label>
                <Controller name="customer_id" control={control} render={({ field }) => (
                  <ComboboxField value={field.value ?? null} onChange={field.onChange}
                    fetchOptions={fetchCustomers} fetchById={fetchCustomerById}
                    placeholder="חיפוש לקוח..." disabled={isBusy} />
                )} />
              </div>

              <div className="space-y-1">
                <Label>ליד</Label>
                <Controller name="lead_id" control={control} render={({ field }) => (
                  <ComboboxField value={field.value ?? null} onChange={field.onChange}
                    fetchOptions={fetchLeads} fetchById={fetchLeadById}
                    placeholder="חיפוש ליד..." disabled={isBusy} />
                )} />
              </div>

              <div className="space-y-1">
                <Label>איש מכירות</Label>
                <Controller name="salesperson_id" control={control} render={({ field }) => (
                  <ComboboxField value={field.value ?? null} onChange={field.onChange}
                    fetchOptions={fetchSalespersons} fetchById={fetchSalespersonById}
                    placeholder="בחר איש מכירות..." disabled={isBusy} />
                )} />
              </div>

              <div className="space-y-1">
                <Label>הצעת מחיר</Label>
                <Controller name="quote_id" control={control} render={({ field }) => (
                  <ComboboxField value={field.value ?? null} onChange={field.onChange}
                    fetchOptions={fetchQuotes} fetchById={fetchQuoteById}
                    placeholder="חיפוש הצעה..." disabled={isBusy} />
                )} />
              </div>

            </div>
          </div>

          <Separator />

          {/* ─── מוצרים (יצירה בלבד, ללא הצעת מחיר) ─────────────── */}
          {!isEdit && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-muted-foreground">
                  מוצרים
                  <span className="text-xs text-muted-foreground/60 mr-2">(אופציונלי — אם אין הצעת מחיר)</span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines(prev => [...prev, newLine()])}
                  disabled={isBusy}
                  className="h-7 gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  הוסף שורה
                </Button>
              </div>

              <div className="space-y-2">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_80px_110px_90px_32px] gap-2 px-1">
                  <p className="text-xs text-muted-foreground">מוצר</p>
                  <p className="text-xs text-muted-foreground text-center">כמות</p>
                  <p className="text-xs text-muted-foreground text-center">מחיר ליח׳</p>
                  <p className="text-xs text-muted-foreground text-left">סכום</p>
                  <span />
                </div>

                {lines.map(line => (
                  <div key={line._key} className="grid grid-cols-[1fr_80px_110px_90px_32px] gap-2 items-center">
                    {/* Product combo */}
                    <ComboboxField
                      value={line.product_id}
                      onChange={(id) => {
                        if (!id) { updateLine(line._key, { product_id: null, product_name: "" }); return; }
                        // find label from options — we'll fetch price in selectProduct
                        fetchProducts(line.product_name || "").then(opts => {
                          const opt = opts.find(o => o.id === id);
                          selectProduct(line._key, id, opt?.label ?? "");
                        }).catch(() => selectProduct(line._key, id, ""));
                      }}
                      fetchOptions={fetchProducts}
                      placeholder="בחר מוצר..."
                      disabled={isBusy}
                    />
                    {/* Quantity */}
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={e => updateLine(line._key, { quantity: e.target.value })}
                      className="w-full border border-border rounded-md px-2 py-1.5 text-sm text-center bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
                      dir="ltr"
                      disabled={isBusy}
                    />
                    {/* Unit price */}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_price}
                      onChange={e => updateLine(line._key, { unit_price: e.target.value })}
                      className="w-full border border-border rounded-md px-2 py-1.5 text-sm text-center bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
                      placeholder="0.00"
                      dir="ltr"
                      disabled={isBusy}
                    />
                    {/* Line total */}
                    <div className="text-sm text-muted-foreground text-left">
                      {lineTotal(line) > 0 ? fmtILS(lineTotal(line)) : "—"}
                    </div>
                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => setLines(prev => prev.filter(l => l._key !== line._key))}
                      disabled={lines.length === 1 || isBusy}
                      className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Totals */}
              {totalExVat > 0 && (
                <div className="mt-3 flex flex-col items-end gap-1 text-sm border-t border-border pt-3">
                  <div className="flex gap-4 text-muted-foreground">
                    <span>סה"כ לפני מע"מ:</span>
                    <span className="w-28 text-left font-medium text-foreground">{fmtILS(totalExVat)}</span>
                  </div>
                  <div className="flex gap-4 text-muted-foreground">
                    <span>מע"מ (18%):</span>
                    <span className="w-28 text-left">{fmtILS(vatAmount)}</span>
                  </div>
                  <div className="flex gap-4 font-semibold">
                    <span>סה"כ כולל מע"מ:</span>
                    <span className="w-28 text-left text-primary">{fmtILS(totalIncVat)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isEdit && <Separator />}

          {/* ─── סטטוסים ─────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-3">סטטוסים</p>
            <div className="grid grid-cols-2 gap-4">

              <div className="space-y-1">
                <Label>סטטוס ביצוע <span className="text-destructive">*</span></Label>
                <select
                  {...register("execution_status")}
                  disabled={isBusy}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {[...new Set([watch("execution_status"), ...EXECUTION_STATUSES].filter(Boolean))].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errors.execution_status && (
                  <p className="text-xs text-destructive">{errors.execution_status.message}</p>
                )}
              </div>

              {/* payment_status is read-only computed in edit mode */}
              {!isEdit && (
                <div className="space-y-1">
                  <Label>סטטוס תשלום</Label>
                  <select
                    {...register("payment_status")}
                    disabled={isBusy}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">— ללא —</option>
                    {PAYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* ─── תשלום ───────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-3">פרטי תשלום</p>
            <div className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>אמצעי תשלום</Label>
                  <select
                    {...register("payment_type")}
                    disabled={isBusy}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="">— ללא —</option>
                    {PAYMENT_TYPES.map((pt) => (
                      <option key={pt.value} value={pt.value}>{pt.label}</option>
                    ))}
                  </select>
                </div>

                {paymentType === "credit_card" && (
                  <div className="space-y-1">
                    <Label>מספר תשלומים <span className="text-destructive">*</span></Label>
                    <Input
                      {...register("installments_count")}
                      type="number" min="1" dir="ltr"
                      disabled={isBusy}
                      placeholder="1"
                      defaultValue="1"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>תאריך רכישה</Label>
                  <Input {...register("purchase_date")} type="date" dir="ltr" disabled={isBusy} />
                </div>
                <div className="space-y-1">
                  <Label>תאריך תשלום הבא</Label>
                  <Input {...register("next_payment_date")} type="date" dir="ltr" disabled={isBusy} />
                </div>
              </div>

            </div>
          </div>

          <Separator />

          {/* ─── חשבונית ─────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-3">פרטי חשבונית</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>שם על החשבונית</Label>
                <Input {...register("invoice_name")} disabled={isBusy} />
              </div>
              <div className="space-y-1">
                <Label>ת.ז / ח.פ</Label>
                <Input {...register("invoice_id_number")} dir="ltr" disabled={isBusy} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>מייל חשבונית</Label>
                <Input {...register("invoice_email")} type="email" dir="ltr" disabled={isBusy} />
              </div>
            </div>
          </div>

          <Separator />

          {/* ─── הערות ───────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-3">הערות</p>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>מה כלול</Label>
                <Textarea {...register("what_is_included")} rows={2} disabled={isBusy} />
              </div>
              <div className="space-y-1">
                <Label>הערות מיוחדות</Label>
                <Textarea {...register("special_notes")} rows={2} disabled={isBusy} />
              </div>
            </div>
          </div>

          {/* ─── קריאה בלבד (עריכה בלבד) ──────────────────────── */}
          {isEdit && deal && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-3">סכומים (לקריאה בלבד)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "סכום עסקה",          value: deal.total_amount },
                    { label: "סכום כולל מע\"מ",    value: deal.total_amount_including_vat },
                    { label: "שולם",               value: deal.paid_amount },
                    { label: "שולם כולל מע\"מ",    value: deal.amount_paid_including_vat },
                    { label: "יתרה",               value: deal.remaining_amount },
                    { label: "שעות סטודיו",         value: deal.studio_hours_remaining },
                    { label: "משימות עריכה",        value: deal.editing_tasks_remaining },
                  ].map(({ label, value }) => (
                    value != null && (
                      <div key={label} className="space-y-1">
                        <Label className="text-muted-foreground">{label}</Label>
                        <div className="h-9 rounded-md border border-input bg-muted px-3 flex items-center text-sm text-muted-foreground">
                          {label.includes("שעות") || label.includes("משימות")
                            ? value
                            : fmtILS(value)}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </>
          )}

        </form>
        </div>

        {/* ── Footer ── */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
            ביטול
          </Button>
          <Button
            type="submit"
            disabled={isBusy}
            onClick={handleSubmit((v) => mutation.mutate(v))}
          >
            {isBusy ? "שומר..." : isEdit ? "שמור שינויים" : "צור עסקה"}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
