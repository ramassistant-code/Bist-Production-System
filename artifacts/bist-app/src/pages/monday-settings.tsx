import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import { ChevronRight, Plus, Pencil, Trash2, Copy, Power, PowerOff, RefreshCw, CheckCircle, AlertCircle, Info, X, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Auth fetch ────────────────────────────────────────────────────────────────

function useAuthedFetch() {
  const { session } = useAuth();
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "שגיאה");
    }
    return res.json();
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MondayTarget {
  id: string;
  target_name: string;
  target_key: string;
  entity_type: string;
  monday_board_id: string;
  monday_group_id?: string;
  monday_workspace_id?: string;
  source_type?: string;
  source_query_key?: string;
  sync_order: number;
  create_enabled: boolean;
  update_enabled: boolean;
  delete_enabled: boolean;
  skip_unchanged_enabled: boolean;
  is_active: boolean;
  updated_at?: string;
}

interface MondayMapping {
  id: string;
  target_id: string;
  monday_column_id: string;
  monday_column_name: string;
  source_field: string;
  value_type: string;
  transform_type: string;
  transform_config?: Record<string, unknown>;
  required: boolean;
  default_value?: string;
  sync_order: number;
  is_active: boolean;
}

interface MondayRun {
  id: string;
  deal_id: string;
  deal_number?: string;
  run_number: number;
  action_type: string;
  status: string;
  progress_percent?: number;
  current_step?: string;
  current_target?: string;
  total_steps?: number;
  created_count?: number;
  updated_count?: number;
  skipped_count?: number;
  failed_count?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  requested_by?: string;
  error_message?: string;
}

interface ValidationResult {
  level: "ok" | "warning" | "error";
  target?: string;
  message: string;
  suggestion?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין",
  queued: "בתור",
  running: "פועל",
  waiting: "ממתין להמשך",
  completed: "הושלם",
  completed_with_warnings: "הושלם עם אזהרות",
  failed: "נכשל",
  cancelled: "בוטל",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  queued: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700",
  waiting: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700",
  completed_with_warnings: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

const VALUE_TYPES = [
  { value: "text", label: "טקסט" },
  { value: "long_text", label: "טקסט ארוך" },
  { value: "number", label: "מספר" },
  { value: "currency", label: "מטבע" },
  { value: "status", label: "סטטוס" },
  { value: "date", label: "תאריך" },
  { value: "datetime", label: "תאריך ושעה" },
  { value: "checkbox", label: "תיבת סימון" },
  { value: "email", label: "אימייל" },
  { value: "phone", label: "טלפון" },
  { value: "link", label: "קישור" },
  { value: "person", label: "אדם" },
  { value: "dropdown", label: "רשימה" },
  { value: "json", label: "JSON" },
];

const TRANSFORM_TYPES = [
  { value: "direct", label: "ישיר" },
  { value: "concatenate", label: "שרשור" },
  { value: "format_currency", label: "פורמט מטבע" },
  { value: "format_date", label: "פורמט תאריך" },
  { value: "boolean_to_label", label: "בוליאן לתווית" },
  { value: "enum_mapping", label: "מיפוי ערכים" },
  { value: "lookup", label: "חיפוש" },
  { value: "constant", label: "קבוע" },
  { value: "fallback", label: "ברירת מחדל" },
  { value: "join_array", label: "חיבור מערך" },
];

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Target Form ───────────────────────────────────────────────────────────────

function TargetForm({
  initial,
  onSave,
  onClose,
  isSaving,
  error,
}: {
  initial?: Partial<MondayTarget>;
  onSave: (data: Partial<MondayTarget>) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string | null;
}) {
  const [form, setForm] = useState<Partial<MondayTarget>>({
    target_name: "",
    target_key: "",
    entity_type: "",
    monday_board_id: "",
    monday_group_id: "",
    monday_workspace_id: "",
    source_query_key: "",
    sync_order: 0,
    create_enabled: true,
    update_enabled: true,
    delete_enabled: false,
    skip_unchanged_enabled: true,
    is_active: false,
    ...initial,
  });

  const set = (k: keyof MondayTarget, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4 py-2" dir="rtl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שם היעד *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.target_name ?? ""} onChange={(e) => set("target_name", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מפתח יעד *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" value={form.target_key ?? ""} onChange={(e) => set("target_key", e.target.value)} placeholder="my_target_key" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סוג ישות *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.entity_type ?? ""} onChange={(e) => set("entity_type", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מפתח שאילתת מקור *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" value={form.source_query_key ?? ""} onChange={(e) => set("source_query_key", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה לוח Monday *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" value={form.monday_board_id ?? ""} onChange={(e) => set("monday_board_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה קבוצה</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" value={form.monday_group_id ?? ""} onChange={(e) => set("monday_group_id", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה Workspace</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono" value={form.monday_workspace_id ?? ""} onChange={(e) => set("monday_workspace_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סדר ריצה</label>
          <input type="number" min={0} className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.sync_order ?? 0} onChange={(e) => set("sync_order", parseInt(e.target.value) || 0)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 pt-1">
        {(["create_enabled", "update_enabled", "delete_enabled", "skip_unchanged_enabled"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={Boolean(form[k])} onChange={(e) => set(k, e.target.checked)} className="rounded" />
            {k === "create_enabled" ? "יצירה פעילה" : k === "update_enabled" ? "עדכון פעיל" : k === "delete_enabled" ? "מחיקה פעילה" : "דלג על נתונים ללא שינוי"}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
          פעיל
        </label>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors">ביטול</button>
        <button type="button" disabled={isSaving} onClick={() => onSave(form)} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors">{isSaving ? "שומר..." : "שמור"}</button>
      </div>
    </div>
  );
}

// ── Tab: Targets ──────────────────────────────────────────────────────────────

function TargetsTab({ authedFetch }: { authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<Partial<MondayTarget> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ targets: MondayTarget[] }>({
    queryKey: ["monday-targets"],
    queryFn: () => authedFetch("/api/monday/targets"),
  });
  const targets = data?.targets ?? [];

  const saveMutation = useMutation({
    mutationFn: (body: Partial<MondayTarget>) =>
      isNew
        ? authedFetch("/api/monday/targets", { method: "POST", body: JSON.stringify(body) })
        : authedFetch(`/api/monday/targets/${editTarget?.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monday-targets"] });
      setEditTarget(null);
    },
    onError: (e) => setFormError((e as Error).message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      authedFetch(`/api/monday/targets/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monday-targets"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authedFetch(`/api/monday/targets/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monday-targets"] }),
    onError: (e) => alert((e as Error).message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground py-6 text-center">טוען יעדים...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{targets.length} יעדים</span>
        <button onClick={() => { setIsNew(true); setEditTarget({}); setFormError(null); }} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
          <Plus className="w-4 h-4" /> יצירת יעד
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">מפתח</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג ישות</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">לוח Monday</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">סדר</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">יצירה</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">עדכון</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {targets.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">אין יעדים. לחץ "יצירת יעד" להוספה.</td></tr>
            )}
            {targets.map((t) => (
              <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{t.target_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.target_key}</td>
                <td className="px-4 py-3 text-muted-foreground">{t.entity_type}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.monday_board_id}</td>
                <td className="px-4 py-3 text-center text-muted-foreground">{t.sync_order}</td>
                <td className="px-4 py-3 text-center">{t.create_enabled ? "✓" : "—"}</td>
                <td className="px-4 py-3 text-center">{t.update_enabled ? "✓" : "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                    {t.is_active ? "פעיל" : "לא פעיל"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => { setIsNew(false); setEditTarget(t); setFormError(null); }} title="עריכה" className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => actionMutation.mutate({ id: t.id, action: "duplicate" })} title="שכפול" className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                    {t.is_active
                      ? <button onClick={() => actionMutation.mutate({ id: t.id, action: "deactivate" })} title="השבת" className="p-1.5 rounded hover:bg-muted/60 text-orange-500 hover:text-orange-700 transition-colors"><PowerOff className="w-3.5 h-3.5" /></button>
                      : <button onClick={() => actionMutation.mutate({ id: t.id, action: "activate" })} title="הפעל" className="p-1.5 rounded hover:bg-muted/60 text-green-600 hover:text-green-800 transition-colors"><Power className="w-3.5 h-3.5" /></button>
                    }
                    <button onClick={() => { if (confirm("למחוק יעד זה?")) deleteMutation.mutate(t.id); }} title="מחיקה" className="p-1.5 rounded hover:bg-muted/60 text-red-500 hover:text-red-700 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNew ? "יצירת יעד חדש" : "עריכת יעד"}</DialogTitle>
          </DialogHeader>
          {editTarget !== null && (
            <TargetForm
              initial={editTarget}
              onSave={(data) => saveMutation.mutate(data)}
              onClose={() => setEditTarget(null)}
              isSaving={saveMutation.isPending}
              error={formError}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Field Mappings ───────────────────────────────────────────────────────

function MappingsTab({ authedFetch }: { authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const qc = useQueryClient();
  const [selectedTarget, setSelectedTarget] = useState<MondayTarget | null>(null);
  const [editMapping, setEditMapping] = useState<Partial<MondayMapping> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: targetsData } = useQuery<{ targets: MondayTarget[] }>({
    queryKey: ["monday-targets"],
    queryFn: () => authedFetch("/api/monday/targets"),
  });
  const targets = targetsData?.targets ?? [];

  const { data: mappingsData, isLoading: loadingMappings } = useQuery<{ mappings: MondayMapping[] }>({
    queryKey: ["monday-mappings", selectedTarget?.id],
    queryFn: () => authedFetch(`/api/monday/targets/${selectedTarget!.id}/mappings`),
    enabled: !!selectedTarget,
  });
  const mappings = mappingsData?.mappings ?? [];

  const saveMutation = useMutation({
    mutationFn: (body: Partial<MondayMapping>) =>
      isNew
        ? authedFetch(`/api/monday/targets/${selectedTarget!.id}/mappings`, { method: "POST", body: JSON.stringify(body) })
        : authedFetch(`/api/monday/targets/${selectedTarget!.id}/mappings/${editMapping?.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monday-mappings", selectedTarget?.id] });
      setEditMapping(null);
    },
    onError: (e) => setFormError((e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => authedFetch(`/api/monday/targets/${selectedTarget!.id}/mappings/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monday-mappings", selectedTarget?.id] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => authedFetch(`/api/monday/targets/${selectedTarget!.id}/mappings/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monday-mappings", selectedTarget?.id] }),
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-foreground/70 mb-2">בחר יעד</label>
        <select
          className="rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedTarget?.id ?? ""}
          onChange={(e) => {
            const t = targets.find((x) => x.id === e.target.value);
            setSelectedTarget(t ?? null);
          }}
        >
          <option value="">-- בחר יעד --</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>{t.target_name} ({t.target_key}) — לוח: {t.monday_board_id}</option>
          ))}
        </select>
      </div>

      {selectedTarget && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{mappings.length} מיפויים</span>
            <button onClick={() => { setIsNew(true); setEditMapping({}); setFormError(null); }} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
              <Plus className="w-4 h-4" /> יצירת מיפוי
            </button>
          </div>

          {loadingMappings ? (
            <p className="text-sm text-muted-foreground">טוען מיפויים...</p>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">עמודת Monday</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">מזהה עמודה</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שדה מקור</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג ערך</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">המרה</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">חובה</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">סדר</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעיל</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {mappings.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">אין מיפויים ליעד זה.</td></tr>
                  )}
                  {mappings.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{m.monday_column_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.monday_column_id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{m.source_field}</td>
                      <td className="px-4 py-3 text-muted-foreground">{VALUE_TYPES.find((v) => v.value === m.value_type)?.label ?? m.value_type}</td>
                      <td className="px-4 py-3 text-muted-foreground">{TRANSFORM_TYPES.find((v) => v.value === m.transform_type)?.label ?? m.transform_type}</td>
                      <td className="px-4 py-3 text-center">{m.required ? "✓" : "—"}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{m.sync_order}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                          {m.is_active ? "פעיל" : "לא פעיל"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => { setIsNew(false); setEditMapping(m); setFormError(null); }} className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => duplicateMutation.mutate(m.id)} className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { if (confirm("למחוק מיפוי זה?")) deleteMutation.mutate(m.id); }} className="p-1.5 rounded hover:bg-muted/60 text-red-500 hover:text-red-700 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog open={editMapping !== null} onOpenChange={(o) => !o && setEditMapping(null)}>
        <DialogContent className="max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNew ? "יצירת מיפוי" : "עריכת מיפוי"}</DialogTitle>
          </DialogHeader>
          {editMapping !== null && (
            <MappingForm
              initial={editMapping}
              onSave={(data) => saveMutation.mutate(data)}
              onClose={() => setEditMapping(null)}
              isSaving={saveMutation.isPending}
              error={formError}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MappingForm({
  initial,
  onSave,
  onClose,
  isSaving,
  error,
}: {
  initial: Partial<MondayMapping>;
  onSave: (data: Partial<MondayMapping>) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string | null;
}) {
  const [form, setForm] = useState<Partial<MondayMapping>>({
    monday_column_id: "",
    monday_column_name: "",
    source_field: "",
    value_type: "text",
    transform_type: "direct",
    required: false,
    default_value: "",
    sync_order: 0,
    is_active: true,
    ...initial,
  });

  const set = (k: keyof MondayMapping, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-3 py-2" dir="rtl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שם עמודת Monday</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_column_name ?? ""} onChange={(e) => set("monday_column_name", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה עמודת Monday</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_column_id ?? ""} onChange={(e) => set("monday_column_id", e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground/70 mb-1">שדה מקור</label>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.source_field ?? ""} onChange={(e) => set("source_field", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סוג ערך</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.value_type ?? "text"} onChange={(e) => set("value_type", e.target.value)}>
            {VALUE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סוג המרה</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.transform_type ?? "direct"} onChange={(e) => set("transform_type", e.target.value)}>
            {TRANSFORM_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">ערך ברירת מחדל</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.default_value ?? ""} onChange={(e) => set("default_value", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סדר</label>
          <input type="number" min={0} className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.sync_order ?? 0} onChange={(e) => set("sync_order", parseInt(e.target.value) || 0)} />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.required)} onChange={(e) => set("required", e.target.checked)} className="rounded" />
          שדה חובה
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
          פעיל
        </label>
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors">ביטול</button>
        <button type="button" disabled={isSaving} onClick={() => onSave(form)} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors">{isSaving ? "שומר..." : "שמור"}</button>
      </div>
    </div>
  );
}

// ── Tab: Runs ─────────────────────────────────────────────────────────────────

function RunsTab({ authedFetch }: { authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", errors_only: "" });

  const { data, isLoading, refetch } = useQuery<{ runs: MondayRun[]; total: number }>({
    queryKey: ["monday-runs", page, filters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (filters.status) params.set("status", filters.status);
      if (filters.errors_only === "true") params.set("errors_only", "true");
      return authedFetch(`/api/monday/runs?${params.toString()}`);
    },
  });

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      authedFetch(`/api/monday/runs/${id}/${action}`, { method: "POST" }),
    onSuccess: () => refetch(),
    onError: (e) => alert((e as Error).message),
  });

  const ACTIVE_STATUSES = ["pending", "queued", "running", "waiting"];
  const RETRY_STATUSES = ["failed", "completed_with_warnings", "completed"];
  const RESUME_STATUSES = ["failed", "waiting"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          className="rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none"
          value={filters.status}
          onChange={(e) => { setFilters((p) => ({ ...p, status: e.target.value })); setPage(1); }}
        >
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={filters.errors_only === "true"} onChange={(e) => { setFilters((p) => ({ ...p, errors_only: e.target.checked ? "true" : "" })); setPage(1); }} className="rounded" />
          ריצות עם שגיאות בלבד
        </label>
        <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors" title="רענן">
          <RefreshCw className="w-4 h-4" />
        </button>
        <span className="text-sm text-muted-foreground mr-auto">{total} ריצות</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">טוען ריצות...</p>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">תאריך</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">מס׳ עסקה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">#</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">נוצרו</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">עודכנו</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">נכשלו</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {runs.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">לא נמצאו ריצות</td></tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.deal_number ?? r.deal_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.run_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.action_type}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{r.created_count ?? "—"}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{r.updated_count ?? "—"}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{r.failed_count ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/settings/monday/runs/${r.id}`}>
                        <a className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors px-1">פרטים</a>
                      </Link>
                      {RETRY_STATUSES.includes(r.status) && (
                        <button onClick={() => actionMutation.mutate({ id: r.id, action: "retry" })} className="text-xs font-medium text-orange-600 hover:text-orange-800 hover:underline transition-colors px-1">נסה שוב</button>
                      )}
                      {RESUME_STATUSES.includes(r.status) && (
                        <button onClick={() => actionMutation.mutate({ id: r.id, action: "resume" })} className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors px-1">המשך</button>
                      )}
                      {ACTIVE_STATUSES.includes(r.status) && (
                        <button onClick={() => { if (confirm("לבטל ריצה זו?")) actionMutation.mutate({ id: r.id, action: "cancel" }); }} className="text-xs font-medium text-red-600 hover:text-red-800 hover:underline transition-colors px-1">בטל</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted/60 disabled:opacity-50 transition-colors">הקודם</button>
          <span className="text-sm text-muted-foreground">עמוד {page} מתוך {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted/60 disabled:opacity-50 transition-colors">הבא</button>
        </div>
      )}
    </div>
  );
}

// ── Tab: Validate ─────────────────────────────────────────────────────────────

function ValidateTab({ authedFetch }: { authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const { data, isLoading, refetch } = useQuery<{ results: ValidationResult[] }>({
    queryKey: ["monday-validate"],
    queryFn: () => authedFetch("/api/monday/validate"),
  });
  const results = data?.results ?? [];

  const byLevel = {
    error: results.filter((r) => r.level === "error"),
    warning: results.filter((r) => r.level === "warning"),
    ok: results.filter((r) => r.level === "ok"),
  };

  const ResultIcon = ({ level }: { level: "ok" | "warning" | "error" }) =>
    level === "ok" ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
    : level === "warning" ? <Info className="w-4 h-4 text-yellow-600 flex-shrink-0" />
    : <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => refetch()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
          <RefreshCw className="w-4 h-4" /> הפעל בדיקה
        </button>
        {!isLoading && (
          <div className="flex gap-3 text-sm">
            {byLevel.error.length > 0 && <span className="text-red-600 font-medium">{byLevel.error.length} שגיאות</span>}
            {byLevel.warning.length > 0 && <span className="text-yellow-600 font-medium">{byLevel.warning.length} אזהרות</span>}
            {byLevel.ok.length > 0 && <span className="text-green-600 font-medium">{byLevel.ok.length} תקין</span>}
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">בודק...</p>}

      {!isLoading && results.length > 0 && (
        <div className="space-y-2">
          {(["error", "warning", "ok"] as const).map((level) =>
            byLevel[level].map((r, i) => (
              <div key={`${level}-${i}`} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                level === "error" ? "border-red-200 bg-red-50" :
                level === "warning" ? "border-yellow-200 bg-yellow-50" :
                "border-green-200 bg-green-50"
              }`}>
                <ResultIcon level={level} />
                <div className="flex-1 min-w-0">
                  {r.target && <p className="text-xs font-medium text-muted-foreground mb-0.5">יעד: {r.target}</p>}
                  <p className={`text-sm font-medium ${level === "error" ? "text-red-800" : level === "warning" ? "text-yellow-800" : "text-green-800"}`}>{r.message}</p>
                  {r.suggestion && <p className="text-xs text-muted-foreground mt-0.5">הצעה: {r.suggestion}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!isLoading && results.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-4">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-800 font-medium">הגדרות Monday תקינות</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: "targets", label: "יעדי סנכרון" },
  { key: "mappings", label: "מיפוי שדות" },
  { key: "runs", label: "ריצות" },
  { key: "validate", label: "בדיקת הגדרות" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function MondaySettings() {
  const authedFetch = useAuthedFetch();
  const [activeTab, setActiveTab] = useState<TabKey>("targets");

  return (
    <Shell title="ניהול Monday">
      <div className="p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/settings"><a className="hover:text-foreground transition-colors">הגדרות</a></Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground">אינטגרציות – Monday</span>
        </div>

        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === t.key
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === "targets" && <TargetsTab authedFetch={authedFetch} />}
          {activeTab === "mappings" && <MappingsTab authedFetch={authedFetch} />}
          {activeTab === "runs" && <RunsTab authedFetch={authedFetch} />}
          {activeTab === "validate" && <ValidateTab authedFetch={authedFetch} />}
        </div>
      </div>
    </Shell>
  );
}
