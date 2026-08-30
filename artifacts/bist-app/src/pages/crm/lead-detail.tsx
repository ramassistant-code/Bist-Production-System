import { useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getGetCrmLeadContextQueryKey,
  getGetCrmLeadQueryKey,
  getListCrmLeadStatusesQueryKey,
  getListCrmLeadsQueryKey,
  getListMyCrmTasksQueryKey,
  getListCrmRejectionReasonsQueryKey,
  useChangeCrmLeadStatus,
  useCreateCrmLeadNote,
  useCreateCrmLeadTask,
  useGetCrmLead,
  useGetCrmLeadContext,
  useListCrmLeadStatuses,
  useListCrmRejectionReasons,
  useUpdateCrmLeadNote,
  useUpdateCrmLeadTask,
} from "@workspace/api-client-react";
import type {
  CrmLeadNote,
  CrmLeadTask,
  CrmRejectionReason,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Clock,
  FileText,
  Handshake,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  PhoneCall,
  UserRound,
} from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import { useCrmView } from "./use-crm-view";
import { useSalesUsers } from "./use-users";
import { crmCurrency, crmDate, crmEmpty } from "./format";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function errorText(error: unknown): string {
  const data = asRecord((error as { data?: unknown })?.data);
  return typeof data.error === "string"
    ? data.error
    : error instanceof Error
      ? error.message
      : "אירעה שגיאה. נסה שוב.";
}

function localDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    status_auto: "אוטומטי",
    manual: "ידני",
    facebook: "פייסבוק",
    instagram: "אינסטגרם",
    whatsapp: "וואטסאפ",
    website: "אתר",
    api: "חיבור מערכת",
  };
  if (labels[source]) return labels[source];
  return /[\u0590-\u05ff]/.test(source) ? source : "מקור חיצוני";
}

export default function CrmLeadDetail() {
  const [, params] = useRoute("/crm/leads/:id");
  const id = params?.id ?? "";
  const { view } = useCrmView();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: reps } = useSalesUsers();
  const [statusOpen, setStatusOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [statusTaskTitle, setStatusTaskTitle] = useState("");
  const [statusDueAt, setStatusDueAt] = useState("");
  const [rejectionCode, setRejectionCode] = useState("");
  const [rejectionDetail, setRejectionDetail] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");

  const leadQuery = useGetCrmLead(id, { view }, {
    query: { enabled: Boolean(id), queryKey: getGetCrmLeadQueryKey(id, { view }) },
  });
  const contextQuery = useGetCrmLeadContext(id, { view }, {
    query: { enabled: Boolean(id), queryKey: getGetCrmLeadContextQueryKey(id, { view }) },
  });
  const { data: statuses } = useListCrmLeadStatuses({ view }, {
    query: { queryKey: getListCrmLeadStatusesQueryKey({ view }) },
  });
  const { data: rejectionReasons } = useListCrmRejectionReasons({
    query: { queryKey: getListCrmRejectionReasonsQueryKey() },
  });

  const invalidateLead = () => {
    void queryClient.invalidateQueries({ queryKey: getGetCrmLeadQueryKey(id, { view }) });
    void queryClient.invalidateQueries({ queryKey: getGetCrmLeadContextQueryKey(id, { view }) });
    void queryClient.invalidateQueries({ queryKey: getListCrmLeadsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListCrmLeadStatusesQueryKey() });
  };

  const statusMutation = useChangeCrmLeadStatus({
    mutation: {
      onSuccess: () => {
        invalidateLead();
        setStatusOpen(false);
      },
    },
  });
  const createNoteMutation = useCreateCrmLeadNote({
    mutation: { onSuccess: () => { invalidateLead(); setNoteText(""); } },
  });
  const updateNoteMutation = useUpdateCrmLeadNote({
    mutation: { onSuccess: () => { invalidateLead(); setEditingNote(null); } },
  });
  const createTaskMutation = useCreateCrmLeadTask({
    mutation: { onSuccess: () => { invalidateLead(); setTaskTitle(""); setTaskDescription(""); setTaskDueAt(""); } },
  });
  const updateTaskMutation = useUpdateCrmLeadTask({
    mutation: {
      onSuccess: () => {
        invalidateLead();
        void queryClient.invalidateQueries({ queryKey: getListMyCrmTasksQueryKey() });
      },
    },
  });

  const allowedStatuses = useMemo(
    () => statuses?.filter((status) => status.code !== "paid" && status.code !== "new") ?? [],
    [statuses],
  );
  const selectedReason = rejectionReasons?.find((reason) => reason.code === rejectionCode);

  if (leadQuery.isLoading || contextQuery.isLoading) {
    return <Shell title="פרטי ליד"><div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></Shell>;
  }
  const missing = isNotFound(leadQuery.error) || isNotFound(contextQuery.error) ||
    (!leadQuery.isError && !leadQuery.data) || (!contextQuery.isError && !contextQuery.data);
  if (missing) {
    return <Shell title="פרטי ליד"><div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card" data-testid="status-crm-lead-not-found"><h2 className="mb-4 text-xl font-bold">הליד לא נמצא</h2><Button asChild><Link href="/crm/leads">חזרה לרשימת הלידים</Link></Button></div></Shell>;
  }
  if (leadQuery.isError || contextQuery.isError) {
    return <Shell title="פרטי ליד"><div className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5" data-testid="status-crm-lead-error"><p className="text-sm text-destructive">שגיאה בטעינת פרטי הליד</p><Button variant="outline" asChild><Link href="/crm/leads">חזרה לרשימת הלידים</Link></Button></div></Shell>;
  }

  const lead = leadQuery.data!;
  const context = contextQuery.data!;
  const rep = reps?.find((user) => user.id === lead.sales_rep_id);
  const latestInquiry = context.inquiries[0];
  const sortedNotes = [...context.notes].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  const sortedTasks = [...context.tasks].sort((a, b) => {
    if ((a.status === "done") !== (b.status === "done")) return a.status === "done" ? 1 : -1;
    return +new Date(a.due_at) - +new Date(b.due_at);
  });
  const openStatusDialog = () => {
    statusMutation.reset();
    setSelectedStatus("");
    setStatusTaskTitle("");
    setStatusDueAt("");
    setRejectionCode("");
    setRejectionDetail("");
    setStatusOpen(true);
  };
  const submitStatus = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedStatus) return;
    statusMutation.mutate({
      id,
      params: { view },
      data: {
        status_code: selectedStatus,
        ...((selectedStatus === "pipe" || selectedStatus === "long_followup") ? { task: { title: statusTaskTitle.trim(), due_at: statusDueAt ? new Date(statusDueAt).toISOString() : "" } } : {}),
        ...(selectedStatus === "not_relevant" ? { rejection_reason_code: rejectionCode, rejection_detail: rejectionDetail.trim() || null } : {}),
      },
    });
  };

  return (
    <Shell title="פרטי ליד">
      <div className="mx-auto max-w-6xl space-y-6 pb-16">
        <Button variant="outline" size="sm" asChild><Link href="/crm/leads" className="gap-2"><ArrowRight className="h-4 w-4" />חזרה ללידים</Link></Button>
        <Card data-testid="card-crm-lead-header">
          <CardContent className="flex flex-col gap-5 pt-6 lg:flex-row lg:items-start lg:justify-between">
            <div><h2 className="text-2xl font-bold">{lead.name}</h2><div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2" dir="ltr"><Phone className="h-4 w-4" />{crmEmpty(lead.phone_e164 || lead.phone_raw)}</span>
              <span className="flex items-center gap-2"><Mail className="h-4 w-4" />{crmEmpty(lead.email)}</span>
              <span className="flex items-center gap-2"><UserRound className="h-4 w-4" />{rep?.full_name || rep?.email || "לא הוקצה"}</span>
            </div></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={openStatusDialog} className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring"><Badge variant="secondary" data-testid="badge-crm-lead-status">{statuses?.find((status) => status.code === lead.status_code)?.label ?? lead.status_code}</Badge></button>
              {lead.is_active_customer && <Badge variant="success">לקוח פעיל</Badge>}
              {lead.pending_reassignment && <Badge variant="warning">ממתין לשיוך</Badge>}
            </div>
          </CardContent>
          {lead.status_code === "not_relevant" && (
            // סיבת הדחייה נשמרה על הליד מאז ומעולם, אבל לא הוצגה בשום מקום.
            // בלעדיה אי אפשר לענות על השאלה שבגללה השדה קיים: למה לידים נופלים.
            <CardContent className="pt-0" data-testid="section-crm-lead-rejection">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <span className="font-medium text-destructive">סיבת דחייה: </span>
                <span>
                  {rejectionReasons?.find(
                    (reason) => reason.code === lead.rejection_reason_code,
                  )?.label ?? crmEmpty(lead.rejection_reason_code)}
                </span>
                {lead.rejection_detail && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {lead.rejection_detail}
                  </p>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        <Card data-testid="section-crm-lead-source"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-primary" />מקור הפנייה</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="מקור" value={sourceLabel(lead.source)} /><Detail label="אסמכתא / קמפיין" value={lead.source_ref} /><Detail label="משפך אחרון" value={latestInquiry?.funnel_name} /><Detail label="מודעה אחרונה" value={latestInquiry?.ad_name} /><Detail label="תאריך יצירה" value={crmDate(lead.created_at, true)} /><Detail label="סטטוס מענה" value={lead.answer_status} />
        </CardContent></Card>

        <Section icon={<Clock className="h-4 w-4 text-primary" />} title={`היסטוריית פניות (${context.inquiries.length})`} testId="section-crm-lead-inquiries">
          {context.inquiries.length === 0 ? <EmptyLine text="אין פניות מתועדות" /> : <div className="space-y-3">{context.inquiries.map((inquiry) => <div key={inquiry.id} className="rounded-lg border border-border bg-muted/40 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>פנייה מספר {inquiry.inquiry_number}</strong><span className="text-xs text-muted-foreground">{crmDate(inquiry.inquiry_at, true)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Detail label="משפך" value={inquiry.funnel_name} /><Detail label="מודעה" value={inquiry.ad_name} /><Detail label="מקור" value={sourceLabel(inquiry.source)} /><Detail label="טופס" value={inquiry.form_name} /></div>{inquiry.free_text && <p className="mt-3 whitespace-pre-wrap rounded-md bg-background p-3 text-muted-foreground">{inquiry.free_text}</p>}</div>)}</div>}
        </Section>
        <Section icon={<PhoneCall className="h-4 w-4 text-primary" />} title={`שיחות (${context.call_logs.length})`} testId="section-crm-lead-calls">
          {context.call_logs.length === 0 ? <EmptyLine text="אין שיחות מתועדות" /> : <div className="space-y-3">{context.call_logs.map((call) => <div key={call.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm"><div><strong>{call.direction === "inbound" ? "שיחה נכנסת" : "שיחה יוצאת"}</strong><span className="mx-2 text-muted-foreground">{crmEmpty(call.result)}</span><p className="text-xs text-muted-foreground">{crmDate(call.started_at, true)}</p></div><span className="text-xs text-muted-foreground">{Math.floor(call.duration_sec / 60)}:{(call.duration_sec % 60).toString().padStart(2, "0")} דקות</span></div>)}</div>}
        </Section>

        <Section icon={<FileText className="h-4 w-4 text-primary" />} title={`הערות (${context.notes.length})`} testId="section-crm-lead-notes">
          <form className="mb-5 space-y-2" onSubmit={(event) => { event.preventDefault(); if (noteText.trim()) createNoteMutation.mutate({ id, params: { view }, data: { content: noteText.trim() } }); }}>
            <Label htmlFor="crm-note">הערה חדשה</Label><Textarea id="crm-note" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="כתוב הערה..." rows={3} disabled={createNoteMutation.isPending} /><Button type="submit" disabled={!noteText.trim() || createNoteMutation.isPending}>{createNoteMutation.isPending ? "שומר..." : "הוסף הערה"}</Button>
            {createNoteMutation.isError && <p className="text-sm text-destructive">{errorText(createNoteMutation.error)}</p>}
          </form>
          {sortedNotes.length === 0 ? <EmptyLine text="אין הערות" /> : <div className="space-y-3">{sortedNotes.map((note) => <NoteItem key={note.id} note={note} userId={appUser?.id} editing={editingNote === note.id} value={editingNoteText} onEdit={() => { setEditingNote(note.id); setEditingNoteText(note.content); }} onChange={setEditingNoteText} onCancel={() => setEditingNote(null)} onSave={() => updateNoteMutation.mutate({ id: note.id, params: { view }, data: { content: editingNoteText.trim() } })} saving={updateNoteMutation.isPending} />)}</div>}
        </Section>

        <Section icon={<CheckCircle2 className="h-4 w-4 text-primary" />} title={`משימות (${context.tasks.length})`} testId="section-crm-lead-tasks">
          <form className="mb-5 grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!taskTitle.trim() || !taskDueAt || new Date(taskDueAt) <= new Date()) return; createTaskMutation.mutate({ id, params: { view }, data: { title: taskTitle.trim(), description: taskDescription.trim() || null, due_at: new Date(taskDueAt).toISOString() } }); }}>
            <div><Label htmlFor="crm-task-title">כותרת משימה</Label><Input id="crm-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div><div><Label htmlFor="crm-task-due">תאריך יעד</Label><Input id="crm-task-due" type="datetime-local" min={localDateTime(new Date().toISOString())} value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} dir="ltr" lang="he-IL" /></div><div className="md:col-span-2"><Label htmlFor="crm-task-description">פירוט (רשות)</Label><Textarea id="crm-task-description" value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} rows={2} /></div><div className="md:col-span-2"><Button type="submit" disabled={!taskTitle.trim() || !taskDueAt || createTaskMutation.isPending}>{createTaskMutation.isPending ? "שומר..." : "הוסף משימה"}</Button>{createTaskMutation.isError && <p className="mt-2 text-sm text-destructive">{errorText(createTaskMutation.error)}</p>}</div>
          </form>
          {sortedTasks.length === 0 ? <EmptyLine text="אין משימות" /> : <div className="space-y-3">{sortedTasks.map((task) => <TaskItem key={task.id} task={task} onDone={() => updateTaskMutation.mutate({ id: task.id, params: { view }, data: { status: "done" } })} saving={updateTaskMutation.isPending} />)}</div>}
        </Section>

        <Section icon={<Handshake className="h-4 w-4 text-primary" />} title={`עסקאות ותשלומים (${context.deals.length})`} testId="section-crm-lead-deals">
          {context.deals.length === 0 ? <EmptyLine text="אין עסקאות" /> : <div className="grid gap-3 md:grid-cols-2">{context.deals.map((deal, index) => { const row = asRecord(deal); const payments = Array.isArray(deal.payments) ? deal.payments : []; const amount = row.total_amount_including_vat ?? row.total_amount; return <div key={String(row.id ?? index)} className="rounded-lg border bg-muted/40 p-4"><div className="flex items-center justify-between gap-3"><strong>{crmEmpty(row.deal_number ?? row.name ?? `עסקה ${index + 1}`)}</strong><Badge variant="outline">{payments.length} תשלומים</Badge></div><p className={deal.amounts_trustworthy ? "mt-3 text-lg font-bold text-primary" : "mt-3 text-lg font-bold text-muted-foreground"}>{crmCurrency(amount)}</p>{!deal.amounts_trustworthy && <p className="mt-1 text-xs font-medium text-muted-foreground">סכום לא מאומת — מקורו במנדיי</p>}</div>; })}</div>}
        </Section>
        <Section icon={<Box className="h-4 w-4 text-primary" />} title={`מוצרים (${context.products.length})`} testId="section-crm-lead-products">
          {context.products.length === 0 ? <EmptyLine text="אין מוצרים" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{context.products.map((product) => <div key={product.id} className="rounded-lg border bg-muted/40 p-3 text-sm"><strong>{product.name}</strong><p className="mt-1 text-xs text-muted-foreground">{crmEmpty(product.category)}</p></div>)}</div>}
        </Section>
      </div>
      {statusOpen && <StatusDialog statuses={allowedStatuses} selected={selectedStatus} onSelect={(code) => { setSelectedStatus(code); setRejectionCode(""); setRejectionDetail(""); }} taskTitle={statusTaskTitle} setTaskTitle={setStatusTaskTitle} dueAt={statusDueAt} setDueAt={setStatusDueAt} reasons={rejectionReasons ?? []} rejectionCode={rejectionCode} setRejectionCode={setRejectionCode} rejectionDetail={rejectionDetail} setRejectionDetail={setRejectionDetail} selectedReason={selectedReason} error={statusMutation.isError ? errorText(statusMutation.error) : null} busy={statusMutation.isPending} onCancel={() => setStatusOpen(false)} onSubmit={submitStatus} />}
    </Shell>
  );
}

function StatusDialog({ statuses, selected, onSelect, taskTitle, setTaskTitle, dueAt, setDueAt, reasons, rejectionCode, setRejectionCode, rejectionDetail, setRejectionDetail, selectedReason, error, busy, onCancel, onSubmit }: { statuses: Array<{ code: string; label: string }>; selected: string; onSelect: (value: string) => void; taskTitle: string; setTaskTitle: (value: string) => void; dueAt: string; setDueAt: (value: string) => void; reasons: CrmRejectionReason[]; rejectionCode: string; setRejectionCode: (value: string) => void; rejectionDetail: string; setRejectionDetail: (value: string) => void; selectedReason?: CrmRejectionReason; error: string | null; busy: boolean; onCancel: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const needsTask = selected === "pipe" || selected === "long_followup";
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation"><div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="crm-status-title"><h2 id="crm-status-title" className="text-xl font-bold">שינוי סטטוס ליד</h2><form className="mt-5 space-y-4" onSubmit={onSubmit}><div><Label htmlFor="crm-status">סטטוס חדש</Label><select id="crm-status" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={(event) => onSelect(event.target.value)}><option value="">בחר סטטוס</option>{statuses.map((status) => <option key={status.code} value={status.code}>{status.label}</option>)}</select></div>{needsTask && <div className="space-y-3 rounded-lg border bg-muted/30 p-3"><p className="font-medium">משימת המשך</p><div><Label htmlFor="crm-status-task-title">כותרת</Label><Input id="crm-status-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div><div><Label htmlFor="crm-status-due">תאריך יעד</Label><Input id="crm-status-due" type="datetime-local" min={localDateTime(new Date().toISOString())} value={dueAt} onChange={(event) => setDueAt(event.target.value)} dir="ltr" lang="he-IL" /></div></div>}{selected === "not_relevant" && <div className="space-y-3 rounded-lg border bg-muted/30 p-3"><div><Label htmlFor="crm-rejection">סיבת דחייה</Label><select id="crm-rejection" className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={rejectionCode} onChange={(event) => setRejectionCode(event.target.value)}><option value="">בחר סיבה</option>{reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></div>{selectedReason?.requires_detail && <div><Label htmlFor="crm-rejection-detail">פירוט</Label><Textarea id="crm-rejection-detail" value={rejectionDetail} onChange={(event) => setRejectionDetail(event.target.value)} rows={3} /></div>}</div>}{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>ביטול</Button><Button type="submit" disabled={!selected || busy}>{busy ? "שומר..." : "שמור"}</Button></div></form></div></div>;
}

function NoteItem({ note, userId, editing, value, onEdit, onChange, onCancel, onSave, saving }: { note: CrmLeadNote; userId?: string; editing: boolean; value: string; onEdit: () => void; onChange: (value: string) => void; onCancel: () => void; onSave: () => void; saving: boolean }) {
  const canEdit = note.user_id === userId && Date.now() - new Date(note.created_at).getTime() < 15 * 60 * 1000;
  return <div className="rounded-lg border bg-muted/40 p-3 text-sm">{editing ? <div className="space-y-2"><Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} /><div className="flex gap-2"><Button type="button" size="sm" onClick={onSave} disabled={!value.trim() || saving}>שמור</Button><Button type="button" size="sm" variant="outline" onClick={onCancel}>ביטול</Button></div></div> : <><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{crmDate(note.created_at, true)}{note.edited_at && " · נערך"}</span>{canEdit && <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-primary hover:underline"><Pencil className="h-3 w-3" />ערוך</button>}</div><p className="mt-2 whitespace-pre-wrap">{note.content}</p></>}</div>;
}

function TaskItem({ task, onDone, saving }: { task: CrmLeadTask; onDone: () => void; saving: boolean }) {
  const done = task.status === "done";
  return <div className={`rounded-lg border bg-muted/40 p-3 text-sm ${done ? "opacity-70" : ""}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className={done ? "line-through" : ""}><strong>{task.title}</strong>{task.description && <p className="mt-2 text-muted-foreground">{task.description}</p>}</div>{!done && <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={saving}>בוצע</Button>}</div><p className="mt-2 text-xs text-muted-foreground">תאריך יעד: {crmDate(task.due_at, true)} · {sourceLabel(task.source)}</p></div>;
}

function Detail({ label, value }: { label: string; value: unknown }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 font-medium">{crmEmpty(value)}</p></div>; }
function Section({ icon, title, testId, children }: { icon: React.ReactNode; title: string; testId: string; children: React.ReactNode }) { return <Card data-testid={testId}><CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>; }
function EmptyLine({ text }: { text: string }) { return <p className="text-sm text-muted-foreground">{text}</p>; }