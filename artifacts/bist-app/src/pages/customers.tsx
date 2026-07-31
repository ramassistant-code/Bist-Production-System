import { useState, useCallback } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Eye, Phone, Mail, Building2, User, Search, X, Trash2 } from "lucide-react";

import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ComboboxField, type ComboboxOption } from "@/components/ui/combobox-field";
import { LookupSelect } from "@/components/ui/lookup-select";

import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api-fetch";
import {
  useListCustomers,
  getListCustomersQueryKey,
} from "@workspace/api-client-react";
import type { Customer } from "@workspace/api-client-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatCurrency(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function empty(val: string | null | undefined): string {
  return val?.trim() ? val.trim() : "—";
}

// ── Form schema ───────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const customerFormSchema = z.object({
  name: z.string().min(1, "שם הלקוח הוא שדה חובה"),
  phone: z.string().nullable().optional(),
  email: z
    .string()
    .email("כתובת אימייל אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  joined_at: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  invoice_name: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  invoice_email: z
    .string()
    .email("כתובת אימייל לחשבוניות אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  customer_type: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  account_manager_contact_status: z.string().nullable().optional(),
  account_manager_contact_date: z.string().nullable().optional(),
  pain_points: z.string().nullable().optional(),
  // FK fields — only valid uuid or null (enforced via ComboboxField)
  account_manager_id: z
    .string()
    .regex(UUID_REGEX, "יש לבחור מהרשימה")
    .nullable()
    .optional(),
  lead_id: z
    .string()
    .regex(UUID_REGEX, "יש לבחור מהרשימה")
    .nullable()
    .optional(),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

function toFormValues(c?: Customer | null): CustomerFormValues {
  return {
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    joined_at: c?.joined_at ?? "",
    birthday: c?.birthday ?? "",
    invoice_name: c?.invoice_name ?? "",
    tax_id: c?.tax_id ?? "",
    invoice_email: c?.invoice_email ?? "",
    customer_type: c?.customer_type ?? null,
    industry: c?.industry ?? null,
    account_manager_contact_status: c?.account_manager_contact_status ?? null,
    account_manager_contact_date: c?.account_manager_contact_date ?? "",
    pain_points: c?.pain_points ?? "",
    account_manager_id: c?.account_manager_id ?? null,
    lead_id: c?.lead_id ?? null,
  };
}

function sanitizeValues(vals: CustomerFormValues): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(vals).map(([k, v]) => [k, v === "" ? null : v]),
  );
}

// ── CustomerFormSupabase ──────────────────────────────────────────────────────

interface CustomerFormSupabaseProps {
  customer?: Customer | null;
  readOnlyValues?: { ltv_amount?: string | null; pipeline_amount_ex_vat?: string | null };
  onSuccess: () => void;
  onCancel: () => void;
}

function CustomerFormSupabase({
  customer,
  readOnlyValues,
  onSuccess,
  onCancel,
}: CustomerFormSupabaseProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: toFormValues(customer),
  });

  // Mutation — create or update via Express API (bypasses RLS, generates customer_number)
  const mutation = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const payload = sanitizeValues(values);
      if (customer) {
        await apiFetch(`/api/customers/${customer.id}`, { method: "PATCH", body: payload });
      } else {
        await apiFetch("/api/customers", { method: "POST", body: payload });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
      toast({ title: customer ? "הלקוח עודכן בהצלחה" : "הלקוח נוצר בהצלחה" });
      toast({ title: "מסנכרן עם המערכת...", description: "הנתונים מועברים ברקע", duration: 3000 });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: err.message || "שגיאה בשמירת הלקוח", variant: "destructive" });
    },
  });

  // Fetch functions for combos — use Express API (bypasses RLS, Bearer token via apiFetch)
  const fetchManagers = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null; is_active: boolean }>>("/api/users");
    return users
      .filter((u) => u.is_active && (!term || (u.full_name ?? "").toLowerCase().includes(term.toLowerCase())))
      .map((u) => ({ id: u.id, label: u.full_name ?? u.id }))
      .slice(0, 50);
  }, []);

  const fetchManagerById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null }>>("/api/users");
    const u = users.find((u) => u.id === id);
    return u ? { id: u.id, label: u.full_name ?? u.id } : null;
  }, []);

  const fetchLeads = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = new URLSearchParams({ limit: "50", ...(term ? { search: term } : {}) });
    const leads = await apiFetch<Array<{ id: string; name: string }>>(`/api/leads?${qs}`);
    return leads.map((l) => ({ id: l.id, label: l.name }));
  }, []);

  const fetchLeadById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const lead = await apiFetch<{ id: string; name: string }>(`/api/leads/${id}`);
    return { id: lead.id, label: lead.name };
  }, []);

  const isLoading = mutation.isPending;

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-5 pt-2" dir="rtl">

      {/* Name */}
      <div className="space-y-1">
        <Label htmlFor="name">
          שם הלקוח <span className="text-destructive">*</span>
        </Label>
        <Input id="name" {...register("name")} disabled={isLoading} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      {/* Phone + Email */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">טלפון</Label>
          <Input id="phone" {...register("phone")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">אימייל</Label>
          <Input id="email" type="email" {...register("email")} disabled={isLoading} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
      </div>

      {/* Customer Type + Industry (lookup selects) */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>סוג לקוח</Label>
          <Controller
            name="customer_type"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_customer_type"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר סוג..."
                disabled={isLoading}
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <Label>תחום עיסוק</Label>
          <Controller
            name="industry"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_industry"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר תחום..."
                disabled={isLoading}
              />
            )}
          />
        </div>
      </div>

      {/* Joined + Birthday */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="joined_at">תאריך הצטרפות</Label>
          <Input id="joined_at" type="date" {...register("joined_at")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="birthday">תאריך לידה</Label>
          <Input id="birthday" type="date" {...register("birthday")} disabled={isLoading} />
        </div>
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">פרטי חשבוניות</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="invoice_name">שם לחשבונית</Label>
          <Input id="invoice_name" {...register("invoice_name")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax_id">מספר עוסק / ח.פ.</Label>
          <Input id="tax_id" {...register("tax_id")} disabled={isLoading} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="invoice_email">אימייל לחשבוניות</Label>
        <Input id="invoice_email" type="email" {...register("invoice_email")} disabled={isLoading} />
        {errors.invoice_email && (
          <p className="text-sm text-destructive">{errors.invoice_email.message}</p>
        )}
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">ניהול תיק</p>

      {/* Account Manager (combobox) */}
      <div className="space-y-1">
        <Label>מנהל תיק לקוח</Label>
        <Controller
          name="account_manager_id"
          control={control}
          render={({ field }) => (
            <ComboboxField
              value={field.value ?? null}
              onChange={field.onChange}
              fetchOptions={fetchManagers}
              fetchById={fetchManagerById}
              placeholder="בחר מנהל תיק..."
              disabled={isLoading}
            />
          )}
        />
        {errors.account_manager_id && (
          <p className="text-sm text-destructive">{errors.account_manager_id.message}</p>
        )}
      </div>

      {/* Contact Status + Contact Date */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>סטטוס יצירת קשר</Label>
          <Controller
            name="account_manager_contact_status"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_contact_status"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר סטטוס..."
                disabled={isLoading}
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="account_manager_contact_date">תאריך יצירת קשר</Label>
          <Input
            id="account_manager_contact_date"
            type="date"
            {...register("account_manager_contact_date")}
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Lead (combobox) */}
      <div className="space-y-1">
        <Label>ליד מקושר</Label>
        <Controller
          name="lead_id"
          control={control}
          render={({ field }) => (
            <ComboboxField
              value={field.value ?? null}
              onChange={field.onChange}
              fetchOptions={fetchLeads}
              fetchById={fetchLeadById}
              placeholder="חיפוש ליד..."
              disabled={isLoading}
            />
          )}
        />
        {errors.lead_id && (
          <p className="text-sm text-destructive">{errors.lead_id.message}</p>
        )}
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">מידע נוסף</p>

      <div className="space-y-1">
        <Label htmlFor="pain_points">צרכים / נקודות כאב</Label>
        <Textarea id="pain_points" {...register("pain_points")} rows={3} disabled={isLoading} />
      </div>

      {/* Read-only financial fields (shown in edit mode only) */}
      {customer && (readOnlyValues?.ltv_amount !== undefined || readOnlyValues?.pipeline_amount_ex_vat !== undefined) && (
        <>
          <Separator />
          <p className="text-sm font-medium text-muted-foreground">נתונים פיננסיים (קריאה בלבד)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>מחזור עסקאות (LTV)</Label>
              <Input
                value={formatCurrency(readOnlyValues?.ltv_amount)}
                disabled
                className="text-muted-foreground"
              />
            </div>
            <div className="space-y-1">
              <Label>צבר עסקאות (לפני מע״מ)</Label>
              <Input
                value={formatCurrency(readOnlyValues?.pipeline_amount_ex_vat)}
                disabled
                className="text-muted-foreground"
              />
            </div>
          </div>
        </>
      )}

      <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse pt-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "שומר..." : "שמירה"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          ביטול
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── CustomerDetails ───────────────────────────────────────────────────────────

interface CustomerDetailsProps {
  customer: Customer;
}

function CustomerDetails({ customer }: CustomerDetailsProps) {
  const mondayRaw = customer.monday_raw_data
    ? JSON.stringify(customer.monday_raw_data, null, 2)
    : null;

  const rows: { label: string; value: string }[] = [
    { label: "מזהה (ID)", value: customer.id },
    { label: "מספר לקוח", value: customer.customer_number },
    { label: "שם", value: customer.name },
    { label: "טלפון", value: empty(customer.phone) },
    { label: "אימייל", value: empty(customer.email) },
    { label: "סוג לקוח", value: empty(customer.customer_type) },
    { label: "תחום עיסוק", value: empty(customer.industry) },
    { label: "תאריך הצטרפות", value: formatDate(customer.joined_at) },
    { label: "תאריך לידה", value: formatDate(customer.birthday) },
    { label: "שם לחשבונית", value: empty(customer.invoice_name) },
    { label: "מספר עוסק / ח.פ.", value: empty(customer.tax_id) },
    { label: "אימייל לחשבוניות", value: empty(customer.invoice_email) },
    { label: "צרכים / נקודות כאב", value: empty(customer.pain_points) },
    { label: "מחזור עסקאות (LTV)", value: formatCurrency(customer.ltv_amount) },
    { label: "צבר עסקאות (לפני מע״מ)", value: formatCurrency(customer.pipeline_amount_ex_vat) },
    { label: "מנהל תיק (ID)", value: empty(customer.account_manager_id) },
    { label: "סטטוס יצירת קשר", value: empty(customer.account_manager_contact_status) },
    { label: "תאריך יצירת קשר", value: formatDate(customer.account_manager_contact_date) },
    { label: "ליד מקושר (ID)", value: empty(customer.lead_id) },
    { label: "Monday - לוח", value: empty(customer.monday_board_id) },
    { label: "Monday - פריט", value: empty(customer.monday_item_id) },
    { label: "Monday - קבוצה", value: empty(customer.monday_group_id) },
    {
      label: "Monday - נתונים גולמיים",
      value: mondayRaw
        ? mondayRaw.slice(0, 120) + (mondayRaw.length > 120 ? "…" : "")
        : "—",
    },
    { label: "נוצר ב", value: formatDate(customer.created_at) },
    { label: "עודכן ב", value: formatDate(customer.updated_at) },
    { label: "נמחק ב", value: formatDate(customer.deleted_at) },
  ];

  return (
    <div className="divide-y divide-border/50" dir="rtl">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between py-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-right max-w-[60%] break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Customers() {
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [detailsCustomer, setDetailsCustomer] = useState<Customer | null>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/customers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "הלקוח נמחק בהצלחה" });
      setDeleteCustomer(null);
      setDetailsCustomer(null);
      void queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
    },
    onError: (err: Error) => {
      toast({ title: err.message || "שגיאה במחיקת הלקוח", variant: "destructive" });
    },
  });

  const { data: customers, isLoading, isError } = useListCustomers();

  const filteredCustomers =
    customers?.filter((c) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.customer_number ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.customer_type ?? "").toLowerCase().includes(q)
      );
    }) ?? [];

  return (
    <Shell title="לקוחות">
      <div className="flex flex-col h-full">
        {/* Top controls */}
        <div className="shrink-0 flex items-center gap-3 px-8 pt-6 pb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון, אימייל..."
              className="w-full border border-border rounded-lg pr-9 pl-8 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {!isLoading && !isError && customers
              ? search.trim()
                ? `${filteredCustomers.length} מתוך ${customers.length}`
                : `${customers.length} לקוחות`
              : ""}
          </p>
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="w-4 h-4 ml-1" />
            לקוח חדש
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-8 pb-6">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">טוען לקוחות...</span>
              </div>
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
                <p className="text-sm text-destructive font-medium">
                  שגיאה בטעינת הלקוחות. אנא נסו שנית.
                </p>
              </div>
            </div>
          )}

          {!isLoading && !isError && customers?.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                title="אין לקוחות להצגה"
                description="לחצו על 'לקוח חדש' להוספת הלקוח הראשון."
              />
            </div>
          )}

          {!isLoading && !isError && customers && customers.length > 0 && filteredCustomers.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                title="לא נמצאו תוצאות"
                description={`לא נמצאו לקוחות התואמים את "${search}"`}
              />
            </div>
          )}

          {!isLoading && !isError && customers && filteredCustomers.length > 0 && (
            <div className="h-full overflow-y-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border/50">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">מספר לקוח</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">טלפון</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">אימייל</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">סוג לקוח</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">הצטרף</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {customer.customer_number}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                          {customer.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {customer.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {customer.phone}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                        {customer.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {customer.email}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {customer.customer_type ? (
                          <Badge variant="outline">{customer.customer_type}</Badge>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">
                        {formatDate(customer.joined_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetailsCustomer(customer)}
                            title="פרטים"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditCustomer(customer)}
                            title="עריכה"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteCustomer(customer)}
                            title="מחיקה"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>לקוח חדש</DialogTitle>
          </DialogHeader>
          <CustomerFormSupabase
            onSuccess={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(open) => !open && setEditCustomer(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת לקוח — {editCustomer?.name}</DialogTitle>
          </DialogHeader>
          {editCustomer && (
            <CustomerFormSupabase
              key={editCustomer.id}
              customer={editCustomer}
              readOnlyValues={{
                ltv_amount: editCustomer.ltv_amount,
                pipeline_amount_ex_vat: editCustomer.pipeline_amount_ex_vat,
              }}
              onSuccess={() => setEditCustomer(null)}
              onCancel={() => setEditCustomer(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <Dialog
        open={!!detailsCustomer}
        onOpenChange={(open) => !open && setDetailsCustomer(null)}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {detailsCustomer?.name}
            </DialogTitle>
          </DialogHeader>
          {detailsCustomer && <CustomerDetails customer={detailsCustomer} />}
          <DialogFooter className="flex-row-reverse justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                const c = detailsCustomer;
                setDetailsCustomer(null);
                setEditCustomer(c);
              }}
            >
              <Pencil className="w-3.5 h-3.5 ml-1" />
              עריכה
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteCustomer(detailsCustomer)}
            >
              <Trash2 className="w-3.5 h-3.5 ml-1" />
              מחיקה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteCustomer} onOpenChange={(open) => !open && setDeleteCustomer(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת לקוח</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק את הלקוח <strong>{deleteCustomer?.name}</strong>?
              <br />
              פעולה זו בלתי הפיכה. לא ניתן למחוק לקוח המקושר לעסקאות, הצעות מחיר, תשלומים או קרדיטים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteCustomer && deleteMutation.mutate(deleteCustomer.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "מוחק..." : "מחק לקוח"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
