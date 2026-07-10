import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Eye, Phone, Mail, User, Target } from "lucide-react";

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

import {
  useListLeads,
  useCreateLead,
  useUpdateLead,
  getListLeadsQueryKey,
} from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";

// ---------- helpers ----------

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
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

// סטטוס → צבע badge
function statusVariant(status: string | null | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (!status) return "secondary";
  if (status.includes("פעיל") || status.includes("סגור")) return "default";
  if (status.includes("דחיי") || status.includes("לא")) return "destructive";
  return "outline";
}

// ---------- form schema ----------

const leadFormSchema = z.object({
  name: z.string().min(1, "שם הליד הוא שדה חובה"),
  phone: z.string().nullable().optional(),
  email: z
    .string()
    .email("כתובת אימייל אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  status: z.string().nullable().optional(),
  answer_status: z.string().nullable().optional(),
  lead_source: z.string().nullable().optional(),
  activity_field: z.string().nullable().optional(),
  followup_at: z.string().nullable().optional(),
  followup_note: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  rejection_reason_text: z.string().nullable().optional(),
  first_deal_amount: z.string().nullable().optional(),
  task_text: z.string().nullable().optional(),
});

type LeadFormValues = z.infer<typeof leadFormSchema>;

function toFormValues(l?: Lead): LeadFormValues {
  return {
    name: l?.name ?? "",
    phone: l?.phone ?? "",
    email: l?.email ?? "",
    status: l?.status ?? "",
    answer_status: l?.answer_status ?? "",
    lead_source: l?.lead_source ?? "",
    activity_field: l?.activity_field ?? "",
    followup_at: l?.followup_at ? l.followup_at.slice(0, 10) : "",
    followup_note: l?.followup_note ?? "",
    rejection_reason: l?.rejection_reason ?? "",
    rejection_reason_text: l?.rejection_reason_text ?? "",
    first_deal_amount: l?.first_deal_amount ?? "",
    task_text: l?.task_text ?? "",
  };
}

function sanitizeValues(vals: LeadFormValues) {
  return Object.fromEntries(
    Object.entries(vals).map(([k, v]) => [k, v === "" ? null : v])
  ) as LeadFormValues;
}

// ---------- LeadForm ----------

interface LeadFormProps {
  defaultValues?: LeadFormValues;
  onSubmit: (values: LeadFormValues) => void;
  isLoading: boolean;
  onCancel: () => void;
}

function LeadForm({ defaultValues, onSubmit, isLoading, onCancel }: LeadFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: defaultValues ?? toFormValues(),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" dir="rtl">
      {/* Name */}
      <div className="space-y-1">
        <Label htmlFor="name">
          שם הליד <span className="text-destructive">*</span>
        </Label>
        <Input id="name" {...register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">טלפון</Label>
          <Input id="phone" {...register("phone")} dir="ltr" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">אימייל</Label>
          <Input id="email" type="email" {...register("email")} dir="ltr" />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">פרטי ליד</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="status">סטטוס</Label>
          <Input id="status" {...register("status")} placeholder="לדוגמה: ליד חדש, לקוח פעיל" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="answer_status">סטטוס מענה</Label>
          <Input id="answer_status" {...register("answer_status")} placeholder="לדוגמה: ענה, לא ענה" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="lead_source">מקור הגעה</Label>
          <Input id="lead_source" {...register("lead_source")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="activity_field">תחום פעילות</Label>
          <Input id="activity_field" {...register("activity_field")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="followup_at">תאריך פולואפ</Label>
          <Input id="followup_at" type="date" {...register("followup_at")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="first_deal_amount">סכום עסקה ראשונה (₪)</Label>
          <Input
            id="first_deal_amount"
            type="number"
            step="0.01"
            {...register("first_deal_amount")}
            dir="ltr"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="followup_note">הערה לפולואפ</Label>
        <Textarea id="followup_note" {...register("followup_note")} rows={2} />
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">דחייה / משימה</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="rejection_reason">סיבת דחייה</Label>
          <Input id="rejection_reason" {...register("rejection_reason")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rejection_reason_text">פירוט סיבת דחייה</Label>
          <Input id="rejection_reason_text" {...register("rejection_reason_text")} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="task_text">משימה</Label>
        <Textarea id="task_text" {...register("task_text")} rows={2} />
      </div>

      <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
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

// ---------- LeadDetails ----------

interface LeadDetailsProps {
  lead: Lead;
}

function LeadDetails({ lead }: LeadDetailsProps) {
  const rows: { label: string; value: string }[] = [
    { label: "מספר ליד", value: lead.lead_number },
    { label: "שם", value: lead.name },
    { label: "טלפון", value: empty(lead.phone) },
    { label: "טלפון (קישור)", value: empty(lead.phone_link) },
    { label: "אימייל", value: empty(lead.email) },
    { label: "סטטוס", value: empty(lead.status) },
    { label: "סטטוס מענה", value: empty(lead.answer_status) },
    { label: "נסיונות תפיסה", value: empty(lead.capture_attempt_status) },
    { label: "מקור הגעה", value: empty(lead.lead_source) },
    { label: "תחום פעילות", value: empty(lead.activity_field) },
    { label: "תאריך פולואפ", value: formatDate(lead.followup_at) },
    { label: "הערה לפולואפ", value: empty(lead.followup_note) },
    { label: "תאריך תזכורת", value: formatDate(lead.reminder_at) },
    { label: "הערה לתזכורת", value: empty(lead.reminder_note) },
    { label: "סיבת דחייה", value: empty(lead.rejection_reason) },
    { label: "פירוט דחייה", value: empty(lead.rejection_reason_text) },
    { label: "תאריך השארת פנייה", value: formatDate(lead.lead_created_at) },
    { label: "תאריך סגירה", value: formatDate(lead.closed_at) },
    { label: "סכום עסקה ראשונה", value: formatCurrency(lead.first_deal_amount) },
    { label: "כמות לידים", value: lead.lead_count != null ? String(lead.lead_count) : "—" },
    { label: "משימה", value: empty(lead.task_text) },
    { label: "תאריך משימה", value: formatDate(lead.task_due_at) },
    { label: "לקוח מקושר (ID)", value: empty(lead.linked_customer_id) },
    { label: "נוצר ב", value: formatDate(lead.created_at) },
    { label: "עודכן ב", value: formatDate(lead.updated_at) },
  ];

  return (
    <div className="divide-y divide-gray-100" dir="rtl">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between py-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-right max-w-[60%] break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Main Page ----------

export default function Leads() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [detailsLead, setDetailsLead] = useState<Lead | null>(null);

  const { data: leads, isLoading, isError } = useListLeads();

  const createMutation = useCreateLead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setCreateOpen(false);
        toast({ title: "הליד נוצר בהצלחה" });
      },
      onError: (err: Error & { data?: { error?: string } }) => {
        const msg = err?.data?.error ?? "שגיאה ביצירת הליד";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateLead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
        setEditLead(null);
        toast({ title: "הליד עודכן בהצלחה" });
      },
      onError: (err: Error & { data?: { error?: string } }) => {
        const msg = err?.data?.error ?? "שגיאה בעדכון הליד";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  function handleCreate(values: LeadFormValues) {
    createMutation.mutate({ data: sanitizeValues(values) });
  }

  function handleEdit(values: LeadFormValues) {
    if (!editLead) return;
    updateMutation.mutate({ id: editLead.id, data: sanitizeValues(values) });
  }

  // סינון
  const allStatuses = Array.from(
    new Set((leads ?? []).map((l) => l.status).filter(Boolean))
  ) as string[];

  const filtered = (leads ?? []).filter((l) => {
    const matchSearch =
      !search ||
      l.name.includes(search) ||
      (l.phone ?? "").includes(search) ||
      (l.email ?? "").includes(search) ||
      (l.lead_number ?? "").includes(search);
    const matchStatus =
      filterStatus === "all" || l.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <Shell title="לידים">
      <div className="flex flex-col h-full">
        {/* Top controls */}
        <div className="shrink-0 px-8 pt-6 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="חיפוש לפי שם, טלפון, מספר..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
                dir="rtl"
              />
              <select
                className="border rounded-md px-3 py-2 text-sm bg-background"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                dir="rtl"
              >
                <option value="all">כל הסטטוסים</option>
                {allStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              {!isLoading && !isError && leads && (
                <span className="text-sm text-muted-foreground">{filtered.length} לידים</span>
              )}
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 ml-1" />
                ליד חדש
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-8 pb-6">
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
              <EmptyState title="אין לידים להצגה" description="לחצו על 'ליד חדש' להוספת הליד הראשון." />
            </div>
          )}

          {!isLoading && !isError && leads && leads.length > 0 && filtered.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState title="לא נמצאו לידים תואמים" description="נסו חיפוש אחר או שנו את הסינון" />
            </div>
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <div className="h-full overflow-y-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">מספר ליד</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">שם</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">טלפון</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">אימייל</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">סטטוס</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">מקור</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">פולואפ</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((lead) => (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {lead.lead_number}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                          {lead.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                        {lead.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {lead.phone}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                        {lead.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {lead.email}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.status ? (
                          <Badge variant={statusVariant(lead.status)}>{lead.status}</Badge>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                        {empty(lead.lead_source)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden xl:table-cell">
                        {formatDate(lead.followup_at)}
                      </td>
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
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>ליד חדש</DialogTitle>
          </DialogHeader>
          <LeadForm
            onSubmit={handleCreate}
            isLoading={createMutation.isPending}
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
            <LeadForm
              key={editLead.id}
              defaultValues={toFormValues(editLead)}
              onSubmit={handleEdit}
              isLoading={updateMutation.isPending}
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
              onClick={() => {
                setDetailsLead(null);
                setEditLead(detailsLead);
              }}
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
