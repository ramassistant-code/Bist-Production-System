import { useState, useCallback, useRef } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus, Pencil, Eye, Phone, Mail, User, Target,
  Search, X,
} from "lucide-react";

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
  useListLeads,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
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

function statusVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" | "destructive" {
  if (!status) return "secondary";
  if (status.includes("פעיל") || status.includes("סגור")) return "default";
  if (status.includes("דחיי") || status.includes("לא")) return "destructive";
  return "outline";
}

/** Extract YYYY-MM-DD from a timestamp string (or return empty string). */
function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  return String(val).slice(0, 10);
}

// ── Form schema ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const leadFormSchema = z.object({
  name: z.string().min(1, "שם הליד הוא שדה חובה"),
  phone: z.string().nullable().optional(),
  email: z
    .string()
    .email("כתובת אימייל אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  // lookup selects
  status: z.string().nullable().optional(),
  answer_status: z.string().nullable().optional(),
  capture_attempt_status: z.string().nullable().optional(),
  lead_source: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  // FK combos
  salesperson_id: z
    .string()
    .regex(UUID_RE, "יש לבחור מהרשימה")
    .nullable()
    .optional(),
  linked_customer_id: z
    .string()
    .regex(UUID_RE, "יש לבחור מהרשימה")
    .nullable()
    .optional(),
  // free text
  referral_name: z.string().nullable().optional(),
  ad_name: z.string().nullable().optional(),
  followup_note: z.string().nullable().optional(),
  rejection_reason_text: z.string().nullable().optional(),
  task_text: z.string().nullable().optional(),
  activity_field: z.string().nullable().optional(),
  // dates
  followup_at: z.string().nullable().optional(),
  task_due_at: z.string().nullable().optional(),
  lead_created_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  // numeric
  first_deal_amount: z.string().nullable().optional(),
});

type LeadFormValues = z.infer<typeof leadFormSchema>;

function toFormValues(l?: Lead | null): LeadFormValues {
  return {
    name: l?.name ?? "",
    phone: l?.phone ?? "",
    email: l?.email ?? "",
    status: l?.status ?? null,
    answer_status: l?.answer_status ?? null,
    capture_attempt_status: l?.capture_attempt_status ?? null,
    lead_source: l?.lead_source ?? null,
    rejection_reason: l?.rejection_reason ?? null,
    salesperson_id: l?.salesperson_id ?? null,
    linked_customer_id: l?.linked_customer_id ?? null,
    referral_name: l?.referral_name ?? "",
    ad_name: l?.ad_name ?? "",
    followup_note: l?.followup_note ?? "",
    rejection_reason_text: l?.rejection_reason_text ?? "",
    task_text: l?.task_text ?? "",
    activity_field: l?.activity_field ?? "",
    followup_at: toDateInput(l?.followup_at),
    task_due_at: toDateInput(l?.task_due_at),
    lead_created_at: toDateInput(l?.lead_created_at),
    closed_at: toDateInput(l?.closed_at),
    first_deal_amount: l?.first_deal_amount ?? "",
  };
}

function sanitizeValues(vals: LeadFormValues): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(vals).map(([k, v]) => [k, v === "" ? null : v]),
  );
}

// ── LeadFormSupabase ──────────────────────────────────────────────────────────

interface LeadFormSupabaseProps {
  lead?: Lead | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function LeadFormSupabase({ lead, onSuccess, onCancel }: LeadFormSupabaseProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: toFormValues(lead),
  });

  // ── Supabase mutation ────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async (values: LeadFormValues) => {
      const payload = sanitizeValues(values);
      if (lead) {
        const { error } = await supabase
          .from("leads")
          .update(payload)
          .eq("id", lead.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("leads")
          .insert(payload);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
      toast({ title: lead ? "הליד עודכן בהצלחה" : "הליד נוצר בהצלחה" });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: err.message || "שגיאה בשמירת הליד", variant: "destructive" });
    },
  });

  // ── Combo fetch functions (via Express API — bypasses RLS) ───────────────────

  // salesperson_id → app_users
  const fetchSalespersons = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null; is_active: boolean }>>(
      "/api/users",
    );
    return users
      .filter((u) => u.is_active && (!term || (u.full_name ?? "").toLowerCase().includes(term.toLowerCase())))
      .map((u) => ({ id: u.id, label: u.full_name ?? u.id }))
      .slice(0, 50);
  }, []);

  const fetchSalespersonById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const users = await apiFetch<Array<{ id: string; full_name: string | null }>>(
      "/api/users",
    );
    const u = users.find((u) => u.id === id);
    return u ? { id: u.id, label: u.full_name ?? u.id } : null;
  }, []);

  // linked_customer_id → customers
  const fetchCustomers = useCallback(async (term: string): Promise<ComboboxOption[]> => {
    const qs = new URLSearchParams({ ...(term ? { search: term } : {}) });
    const customers = await apiFetch<Array<{ id: string; name: string }>>(
      `/api/customers${qs.toString() ? `?${qs}` : ""}`,
    );
    return customers.map((c) => ({ id: c.id, label: c.name })).slice(0, 50);
  }, []);

  const fetchCustomerById = useCallback(async (id: string): Promise<ComboboxOption | null> => {
    const customer = await apiFetch<{ id: string; name: string }>(`/api/customers/${id}`);
    return { id: customer.id, label: customer.name };
  }, []);

  const isLoading = mutation.isPending;

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" dir="rtl">

      {/* שם */}
      <div className="space-y-1">
        <Label htmlFor="name">
          שם הליד <span className="text-destructive">*</span>
        </Label>
        <Input id="name" {...register("name")} disabled={isLoading} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      {/* טלפון + אימייל */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">טלפון</Label>
          <Input id="phone" {...register("phone")} dir="ltr" disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">אימייל</Label>
          <Input id="email" type="email" {...register("email")} dir="ltr" disabled={isLoading} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">סטטוסים</p>

      {/* סטטוס + מענה */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>סטטוס</Label>
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_lead_status"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר סטטוס..."
                disabled={isLoading}
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <Label>מענה</Label>
          <Controller
            name="answer_status"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_answer_status"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר מענה..."
                disabled={isLoading}
              />
            )}
          />
        </div>
      </div>

      {/* ניסיון תפיסה + מקור הגעה */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>ניסיון תפיסה</Label>
          <Controller
            name="capture_attempt_status"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_capture_attempt"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר ניסיון..."
                disabled={isLoading}
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <Label>מקור הגעה</Label>
          <Controller
            name="lead_source"
            control={control}
            render={({ field }) => (
              <LookupSelect
                table="lookup_lead_source"
                value={field.value ?? null}
                onChange={field.onChange}
                placeholder="בחר מקור..."
                disabled={isLoading}
              />
            )}
          />
        </div>
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">אנשים מקושרים</p>

      {/* איש מכירות */}
      <div className="space-y-1">
        <Label>איש מכירות</Label>
        <Controller
          name="salesperson_id"
          control={control}
          render={({ field }) => (
            <ComboboxField
              value={field.value ?? null}
              onChange={field.onChange}
              fetchOptions={fetchSalespersons}
              fetchById={fetchSalespersonById}
              placeholder="בחר איש מכירות..."
              disabled={isLoading}
            />
          )}
        />
        {errors.salesperson_id && (
          <p className="text-sm text-destructive">{errors.salesperson_id.message}</p>
        )}
      </div>

      {/* לקוח מקושר */}
      <div className="space-y-1">
        <Label>לקוח מקושר</Label>
        <Controller
          name="linked_customer_id"
          control={control}
          render={({ field }) => (
            <ComboboxField
              value={field.value ?? null}
              onChange={field.onChange}
              fetchOptions={fetchCustomers}
              fetchById={fetchCustomerById}
              placeholder="חיפוש לקוח..."
              disabled={isLoading}
            />
          )}
        />
        {errors.linked_customer_id && (
          <p className="text-sm text-destructive">{errors.linked_customer_id.message}</p>
        )}
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">פרטי מקור ופולואפ</p>

      {/* שם ממליץ + שם מודעה */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="referral_name">שם ממליץ</Label>
          <Input id="referral_name" {...register("referral_name")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ad_name">שם מודעה</Label>
          <Input id="ad_name" {...register("ad_name")} disabled={isLoading} />
        </div>
      </div>

      {/* תחום פעילות */}
      <div className="space-y-1">
        <Label htmlFor="activity_field">תחום פעילות</Label>
        <Input id="activity_field" {...register("activity_field")} disabled={isLoading} />
      </div>

      {/* תאריך פולואפ + הערה */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="followup_at">תאריך פולואפ</Label>
          <Input id="followup_at" type="date" {...register("followup_at")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="task_due_at">תאריך משימה</Label>
          <Input id="task_due_at" type="date" {...register("task_due_at")} disabled={isLoading} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="followup_note">הערה לפולואפ</Label>
        <Textarea id="followup_note" {...register("followup_note")} rows={2} disabled={isLoading} />
      </div>

      {/* תאריכי כניסה + סגירה */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="lead_created_at">תאריך השארת פנייה</Label>
          <Input id="lead_created_at" type="date" {...register("lead_created_at")} disabled={isLoading} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="closed_at">תאריך סגירה</Label>
          <Input id="closed_at" type="date" {...register("closed_at")} disabled={isLoading} />
        </div>
      </div>

      {/* סכום עסקה ראשונה */}
      <div className="space-y-1">
        <Label htmlFor="first_deal_amount">סכום עסקה ראשונה (₪)</Label>
        <Input
          id="first_deal_amount"
          type="number"
          step="0.01"
          min="0"
          {...register("first_deal_amount")}
          dir="ltr"
          disabled={isLoading}
        />
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">דחייה ומשימה</p>

      {/* סיבת דחייה + פירוט */}
      <div className="space-y-1">
        <Label>סיבת דחייה</Label>
        <Controller
          name="rejection_reason"
          control={control}
          render={({ field }) => (
            <LookupSelect
              table="lookup_rejection_reason"
              value={field.value ?? null}
              onChange={field.onChange}
              placeholder="בחר סיבת דחייה..."
              disabled={isLoading}
            />
          )}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="rejection_reason_text">פירוט סיבת דחייה</Label>
        <Textarea
          id="rejection_reason_text"
          {...register("rejection_reason_text")}
          rows={2}
          disabled={isLoading}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="task_text">משימה</Label>
        <Textarea id="task_text" {...register("task_text")} rows={2} disabled={isLoading} />
      </div>

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

// ── LeadDetails ───────────────────────────────────────────────────────────────

function LeadDetails({ lead }: { lead: Lead }) {
  const rows: { label: string; value: string }[] = [
    { label: "מספר ליד", value: lead.lead_number },
    { label: "שם", value: lead.name },
    { label: "טלפון", value: empty(lead.phone) },
    { label: "אימייל", value: empty(lead.email) },
    { label: "סטטוס", value: empty(lead.status) },
    { label: "מענה", value: empty(lead.answer_status) },
    { label: "ניסיון תפיסה", value: empty(lead.capture_attempt_status) },
    { label: "מקור הגעה", value: empty(lead.lead_source) },
    { label: "שם ממליץ", value: empty(lead.referral_name) },
    { label: "שם מודעה", value: empty(lead.ad_name) },
    { label: "תחום פעילות", value: empty(lead.activity_field) },
    { label: "תאריך פולואפ", value: formatDate(lead.followup_at) },
    { label: "הערה לפולואפ", value: empty(lead.followup_note) },
    { label: "תאריך משימה", value: formatDate(lead.task_due_at) },
    { label: "משימה", value: empty(lead.task_text) },
    { label: "סיבת דחייה", value: empty(lead.rejection_reason) },
    { label: "פירוט דחייה", value: empty(lead.rejection_reason_text) },
    { label: "תאריך השארת פנייה", value: formatDate(lead.lead_created_at) },
    { label: "תאריך סגירה", value: formatDate(lead.closed_at) },
    { label: "סכום עסקה ראשונה", value: formatCurrency(lead.first_deal_amount) },
    { label: "איש מכירות (ID)", value: empty(lead.salesperson_id) },
    { label: "לקוח מקושר (ID)", value: empty(lead.linked_customer_id) },
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

const DEBOUNCE_MS = 400;
const LIMIT = 300;

export default function Leads() {
  const { toast } = useToast();

  const [apiSearch, setApiSearch] = useState("");
  const [inputSearch, setInputSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [page, setPage] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [detailsLead, setDetailsLead] = useState<Lead | null>(null);

  const params = {
    ...(apiSearch ? { search: apiSearch } : {}),
    limit: LIMIT,
    offset: page * LIMIT,
  };

  const { data: leads, isLoading, isError } = useListLeads(params, {
    query: { queryKey: getListLeadsQueryKey(params) },
  });

  const handleSearchChange = useCallback((val: string) => {
    setInputSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setApiSearch(val);
      setPage(0);
    }, DEBOUNCE_MS);
  }, []);

  const showingCount = leads?.length ?? 0;
  const hasMore = showingCount === LIMIT;
  const hasPrev = page > 0;

  function handleSuccess(type: "create" | "edit") {
    if (type === "create") setCreateOpen(false);
    else setEditLead(null);
  }

  return (
    <Shell title="לידים">
      <div className="flex flex-col h-full">

        {/* Top controls */}
        <div className="shrink-0 flex items-center gap-3 px-8 pt-6 pb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={inputSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון, מספר..."
              className="w-full border border-border rounded-lg pr-9 pl-8 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {inputSearch && (
              <button
                onClick={() => { setInputSearch(""); setApiSearch(""); setPage(0); }}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {!isLoading && !isError && leads
              ? `${showingCount} לידים${hasMore ? ` (עמוד ${page + 1})` : ""}`
              : ""}
          </p>
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="w-4 h-4 ml-1" />
            ליד חדש
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-8 pb-2">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">טוען לידים...</span>
              </div>
            </div>
          )}
          {isError && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
                <p className="text-sm text-destructive font-medium">שגיאה בטעינת הלידים. אנא נסו שנית.</p>
              </div>
            </div>
          )}
          {!isLoading && !isError && leads?.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                title={apiSearch ? "לא נמצאו לידים תואמים" : "אין לידים להצגה"}
                description={apiSearch ? "נסו חיפוש אחר" : "לחצו על 'ליד חדש' להוספת הליד הראשון."}
              />
            </div>
          )}
          {!isLoading && !isError && leads && leads.length > 0 && (
            <div className="h-full overflow-y-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border/50">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">מספר ליד</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">טלפון</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">אימייל</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">מקור</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">פולואפ</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono text-xs">{lead.lead_number}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                          {lead.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {lead.phone
                          ? <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                        {lead.email
                          ? <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{lead.email}</span>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {lead.status
                          ? <Badge variant={statusVariant(lead.status)}>{lead.status}</Badge>
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{empty(lead.lead_source)}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">{formatDate(lead.followup_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setDetailsLead(lead)} title="פרטים">
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditLead(lead)} title="עריכה">
                            <Pencil className="w-4 h-4" />
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

        {/* Pagination */}
        {!isLoading && !isError && (hasPrev || hasMore) && (
          <div className="shrink-0 flex items-center justify-center gap-3 px-8 py-3 border-t border-border/50 bg-card">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={!hasPrev}>
              הקודם
            </Button>
            <span className="text-sm text-muted-foreground">עמוד {page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasMore}>
              הבא
            </Button>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ליד חדש</DialogTitle>
          </DialogHeader>
          <LeadFormSupabase
            onSuccess={() => handleSuccess("create")}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editLead} onOpenChange={(open) => !open && setEditLead(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת ליד — {editLead?.name}</DialogTitle>
          </DialogHeader>
          {editLead && (
            <LeadFormSupabase
              key={editLead.id}
              lead={editLead}
              onSuccess={() => handleSuccess("edit")}
              onCancel={() => setEditLead(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <Dialog open={!!detailsLead} onOpenChange={(open) => !open && setDetailsLead(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              {detailsLead?.name}
            </DialogTitle>
          </DialogHeader>
          {detailsLead && <LeadDetails lead={detailsLead} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDetailsLead(null); setEditLead(detailsLead); }}
            >
              <Pencil className="w-3.5 h-3.5 ml-1" />
              עריכה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
