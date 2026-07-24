import { useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxField, type ComboboxOption } from "@/components/ui/combobox-field";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXECUTION_STATUSES = ["פתוחה", "ממתינה לתיאום", "בטיפול", "הושלמה", "בוטלה"];
const PAYMENT_STATUSES   = ["ממתינה לתשלום", "תשלום חלקי", "שולמה במלואה", "בוטלה"];
const PAYMENT_TYPES = [
  { value: "credit_card",    label: "אשראי" },
  { value: "cash",           label: "מזומן" },
  { value: "bank_transfer",  label: "העברה בנקאית" },
];

function fmtILS(v: string | number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const uuidOrNull = z.string().regex(UUID_RE).nullable().optional();
const strOrNull  = z.string().nullable().optional();

const dealSchema = z.object({
  customer_id:       uuidOrNull,
  lead_id:           uuidOrNull,
  salesperson_id:    uuidOrNull,
  quote_id:          uuidOrNull,
  execution_status:  z.string().min(1, "שדה חובה"),
  payment_status:    strOrNull,
  payment_type:      strOrNull,
  installments_count: strOrNull,
  purchase_date:     strOrNull,
  next_payment_date: strOrNull,
  invoice_name:      strOrNull,
  invoice_id_number: strOrNull,
  invoice_email:     strOrNull,
  what_is_included:  strOrNull,
  special_notes:     strOrNull,
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
    customer_id:       d?.customer_id       ?? null,
    lead_id:           d?.lead_id           ?? null,
    salesperson_id:    d?.salesperson_id    ?? null,
    quote_id:          d?.quote_id          ?? null,
    execution_status:  d?.execution_status  ?? "פתוחה",
    payment_status:    d?.payment_status    ?? null,
    payment_type:      d?.payment_type      ?? null,
    installments_count: d?.installments_count != null ? String(d.installments_count) : "",
    purchase_date:     d?.purchase_date     ?? "",
    next_payment_date: d?.next_payment_date ?? "",
    invoice_name:      d?.invoice_name      ?? "",
    invoice_id_number: d?.invoice_id_number ?? "",
    invoice_email:     d?.invoice_email     ?? "",
    what_is_included:  d?.what_is_included  ?? "",
    special_notes:     d?.special_notes     ?? "",
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
        const { error } = await supabase
          .from("deals")
          .update(patch)
          .eq("id", deal!.id);
        if (error) throw new Error(error.message);
        return { id: deal!.id };
      } else {
        const created = await apiFetch<{ id: string }>("/api/deals/standalone", {
          method: "POST", body: patch,
        });
        return { id: created.id };
      }
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", id] });
      toast({ title: isEdit ? "העסקה עודכנה בהצלחה" : "העסקה נוצרה בהצלחה" });
      toast({ title: "מסנכרן עם המערכת...", description: "הנתונים מועברים ברקע", duration: 3000 });
      if (onSuccess) onSuccess(id);
      else if (!isEdit) navigate(`/deals/${id}`);
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: err.message || "שגיאה בשמירת העסקה", variant: "destructive" });
    },
  });

  // ── Combo fetch: customers via Supabase ─────────────────────────────────────

  const fetchCustomers = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    let q = supabase.from("customers").select("id,name").is("deleted_at", null).order("name").limit(50);
    if (term) q = (q as typeof q).ilike("name", `%${term}%`);
    const { data } = await q;
    return (data ?? []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name }));
  }, []);

  const fetchCustomerById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const { data } = await supabase.from("customers").select("id,name").eq("id", id).single();
    return data ? { id: data.id, label: data.name } : null;
  }, []);

  // ── Combo fetch: leads via Supabase ─────────────────────────────────────────

  const fetchLeads = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    let q = supabase.from("leads").select("id,name").is("deleted_at", null).order("name").limit(50);
    if (term) q = (q as typeof q).ilike("name", `%${term}%`);
    const { data } = await q;
    return (data ?? []).map((l: { id: string; name: string }) => ({ id: l.id, label: l.name }));
  }, []);

  const fetchLeadById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const { data } = await supabase.from("leads").select("id,name").eq("id", id).single();
    return data ? { id: data.id, label: data.name } : null;
  }, []);

  // ── Combo fetch: salesperson via Express API (app_users has RLS) ─────────────

  const fetchSalespersons = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null; is_active: boolean }>>("/api/users");
    return users
      .filter((u) => u.is_active && (!term || (u.full_name ?? "").toLowerCase().includes(term.toLowerCase())))
      .map((u) => ({ id: u.id, label: u.full_name ?? u.id }))
      .slice(0, 50);
  }, []);

  const fetchSalespersonById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null }>>("/api/users");
    const u = users.find((u) => u.id === id);
    return u ? { id: u.id, label: u.full_name ?? u.id } : null;
  }, []);

  // ── Combo fetch: quotes via Supabase ─────────────────────────────────────────

  const fetchQuotes = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    let q = supabase.from("quotes").select("id,quote_number").is("deleted_at", null).order("quote_number", { ascending: false }).limit(50);
    if (term) q = (q as typeof q).ilike("quote_number", `%${term}%`);
    const { data } = await q;
    return (data ?? []).map((q: { id: string; quote_number: string }) => ({ id: q.id, label: q.quote_number }));
  }, []);

  const fetchQuoteById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const { data } = await supabase.from("quotes").select("id,quote_number").eq("id", id).single();
    return data ? { id: data.id, label: data.quote_number } : null;
  }, []);

  const isBusy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `עריכת עסקה — ${deal!.deal_number}` : "עסקה חדשה"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5">

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
                  {EXECUTION_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {errors.execution_status && (
                  <p className="text-xs text-destructive">{errors.execution_status.message}</p>
                )}
              </div>

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
                    <Label>מספר תשלומים</Label>
                    <Input
                      {...register("installments_count")}
                      type="number" min="1" dir="ltr"
                      disabled={isBusy}
                      placeholder="1"
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

          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isBusy}>
              ביטול
            </Button>
            <Button type="submit" disabled={isBusy}>
              {isBusy ? "שומר..." : isEdit ? "שמור שינויים" : "צור עסקה"}
            </Button>
          </DialogFooter>

        </form>
      </DialogContent>
    </Dialog>
  );
}
