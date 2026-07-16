import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import {
  ChevronRight, Plus, Pencil, Trash2, Copy, RefreshCw,
  CheckCircle, AlertCircle, Info, ArrowRightLeft, ArrowRight, ArrowLeft,
  Shield, Clock, Activity,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ── Auth fetch ────────────────────────────────────────────────────────────────

function useAuthedFetch() {
  const { session } = useAuth();
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return useCallback(async (path: string, init?: RequestInit) => {
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
  }, [session?.access_token, base]);
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
  board_name_expected?: string;
  environment?: string;
  source_type?: string;
  source_query_key?: string;
  sync_order: number;
  create_enabled: boolean;
  update_enabled: boolean;
  delete_enabled: boolean;
  skip_unchanged_enabled: boolean;
  is_active: boolean;
  inbound_enabled?: boolean;
  outbound_enabled?: boolean;
  polling_interval_seconds?: number;
  polling_overlap_seconds?: number;
  allow_inbound_create?: boolean;
  allow_inbound_archive?: boolean;
  allow_inbound_delete?: boolean;
  inbound_create_policy?: string;
  inbound_missing_link_policy?: string;
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
  // bidirectional fields
  sync_direction?: string;
  field_authority?: string;
  conflict_policy?: string;
  inbound_transform_type?: string;
  inbound_transform_config?: Record<string, unknown>;
  outbound_transform_type?: string;
  outbound_transform_config?: Record<string, unknown>;
  allow_null_inbound?: boolean;
  allow_null_outbound?: boolean;
  inbound_validation?: Record<string, unknown>;
  is_sensitive?: boolean;
}

interface HealthRow {
  target_id: string;
  target_key: string;
  target_name: string;
  environment: string;
  monday_board_id: string;
  is_active: boolean;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  polling_status?: string;
  last_poll_completed_at?: string;
  last_successful_sync_at?: string;
  next_poll_at?: string;
  consecutive_failures?: number;
  last_error_code?: string;
  pending_events?: number;
  failed_events?: number;
  open_conflicts?: number;
}

interface HealthSummary {
  active_targets: number;
  polling_active: number;
  pending_events: number;
  failed_events: number;
  open_conflicts: number;
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
  pending: "ממתין", queued: "בתור", running: "פועל",
  waiting: "ממתין להמשך", completed: "הושלם",
  completed_with_warnings: "הושלם עם אזהרות", failed: "נכשל", cancelled: "בוטל",
};
const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700", queued: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700", waiting: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700",
  completed_with_warnings: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700", cancelled: "bg-muted text-muted-foreground",
};
const POLLING_STATUS_LABELS: Record<string, string> = {
  idle: "ממתין", running: "פועל כעת", waiting: "בהמתנה", failed: "נכשל", disabled: "כבוי",
};

const ENV_LABELS: Record<string, string> = { test: "בדיקות", production: "ייצור" };

const DIRECTION_LABELS: Record<string, string> = {
  supabase_to_monday: "Supabase → Monday",
  monday_to_supabase: "Monday → Supabase",
  bidirectional: "דו-כיווני",
  disabled: "כבוי",
};
const AUTHORITY_LABELS: Record<string, string> = {
  supabase: "Supabase", monday: "Monday", shared: "משותפת", manual: "הכרעה ידנית",
};
const CONFLICT_LABELS: Record<string, string> = {
  authority_wins: "הצד הבעלים מנצח", supabase_wins: "Supabase מנצח",
  monday_wins: "Monday מנצח", latest_wins: "העדכון האחרון מנצח", manual: "הכרעה ידנית",
};
const CREATE_POLICY_LABELS: Record<string, string> = {
  reject: "חסום", review: "העבר לבדיקה", create: "צור אוטומטית",
};
const MISSING_LINK_LABELS: Record<string, string> = {
  ignore: "התעלם", review: "העבר לבדיקה", create: "צור רשומה",
};

const VALUE_TYPES = [
  { value: "text", label: "טקסט" }, { value: "long_text", label: "טקסט ארוך" },
  { value: "number", label: "מספר" }, { value: "currency", label: "מטבע" },
  { value: "status", label: "סטטוס" }, { value: "date", label: "תאריך" },
  { value: "datetime", label: "תאריך ושעה" }, { value: "checkbox", label: "תיבת סימון" },
  { value: "email", label: "אימייל" }, { value: "phone", label: "טלפון" },
  { value: "link", label: "קישור" }, { value: "person", label: "אדם" },
  { value: "dropdown", label: "רשימה" }, { value: "json", label: "JSON" },
];

const TRANSFORM_TYPES = [
  { value: "identity", label: "ישיר (ללא שינוי)" },
  { value: "direct", label: "ישיר (legacy)" },
  { value: "text", label: "טקסט" },
  { value: "integer", label: "מספר שלם" },
  { value: "decimal", label: "עשרוני" },
  { value: "boolean", label: "בוליאן" },
  { value: "date", label: "תאריך" },
  { value: "datetime", label: "תאריך ושעה" },
  { value: "status_label_to_value", label: "תווית סטטוס → ערך" },
  { value: "status_value_to_label", label: "ערך סטטוס → תווית" },
  { value: "person_id_to_user_id", label: "מזהה אדם → משתמש" },
  { value: "user_id_to_person_id", label: "מזהה משתמש → אדם" },
  { value: "json_path", label: "JSON Path" },
  { value: "enum_map", label: "מיפוי ערכים (Enum)" },
  { value: "phone_normalize", label: "נרמול טלפון" },
  { value: "email_normalize", label: "נרמול אימייל" },
  { value: "concatenate", label: "שרשור" },
  { value: "format_currency", label: "פורמט מטבע" },
  { value: "format_date", label: "פורמט תאריך" },
  { value: "boolean_to_label", label: "בוליאן לתווית" },
  { value: "enum_mapping", label: "מיפוי ערכים (legacy)" },
  { value: "lookup", label: "חיפוש" },
  { value: "constant", label: "קבוע" },
  { value: "fallback", label: "ברירת מחדל" },
  { value: "join_array", label: "חיבור מערך" },
];

const PROTECTED_ENTITY_TYPES = ["deal", "payment"];

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function computeTargetStatus(t: MondayTarget): string {
  if (!t.monday_board_id || t.monday_board_id === "CONFIGURE_BOARD_ID") return "לא מוגדר";
  if (!t.board_name_expected) return "מוגדר חלקית";
  if (t.allow_inbound_create && t.inbound_create_policy === "reject") return "חסום";
  if (t.allow_inbound_delete && PROTECTED_ENTITY_TYPES.includes(t.entity_type)) return "חסום";
  if (t.is_active) return "פעיל";
  if (t.monday_board_id && t.board_name_expected) return "מוכן לבדיקה";
  return "מוגדר חלקית";
}

function TargetStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    "פעיל": "bg-green-100 text-green-700",
    "מוכן לבדיקה": "bg-blue-100 text-blue-700",
    "מוגדר חלקית": "bg-yellow-100 text-yellow-700",
    "לא מוגדר": "bg-muted text-muted-foreground",
    "חסום": "bg-red-100 text-red-700",
    "שגיאה": "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SyncDirIcon({ dir }: { dir?: string }) {
  if (!dir || dir === "disabled") return <span className="text-muted-foreground text-xs">—</span>;
  if (dir === "supabase_to_monday") return <span title="Supabase → Monday"><ArrowLeft className="w-3.5 h-3.5 text-blue-600" /></span>;
  if (dir === "monday_to_supabase") return <span title="Monday → Supabase"><ArrowRight className="w-3.5 h-3.5 text-purple-600" /></span>;
  return <span title="דו-כיווני"><ArrowRightLeft className="w-3.5 h-3.5 text-green-600" /></span>;
}

// ── Section Heading ────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2 pb-1 border-b border-border/50">{children}</p>;
}

// ── Target Form ───────────────────────────────────────────────────────────────

const TARGET_DEFAULTS: Partial<MondayTarget> = {
  target_name: "", target_key: "", entity_type: "", monday_board_id: "",
  monday_group_id: "", monday_workspace_id: "", board_name_expected: "",
  source_query_key: "", sync_order: 0, environment: "test",
  create_enabled: true, update_enabled: true, delete_enabled: false,
  skip_unchanged_enabled: true, is_active: false,
  inbound_enabled: false, outbound_enabled: false,
  polling_interval_seconds: 120, polling_overlap_seconds: 300,
  allow_inbound_create: false, allow_inbound_archive: false, allow_inbound_delete: false,
  inbound_create_policy: "reject", inbound_missing_link_policy: "review",
};

function computeClientBlockers(form: Partial<MondayTarget>): string[] {
  const blockers: string[] = [];
  if (!form.monday_board_id || form.monday_board_id === "CONFIGURE_BOARD_ID")
    blockers.push("מזהה לוח Monday לא הוגדר");
  if (!form.board_name_expected)
    blockers.push("שם לוח צפוי לא הוגדר");
  if (form.environment === "test" && form.board_name_expected && !form.board_name_expected.startsWith("TEST |"))
    blockers.push("סביבת בדיקות: שם הלוח חייב להתחיל ב-'TEST |'");
  if (form.allow_inbound_create && form.inbound_create_policy === "reject")
    blockers.push("יצירת רשומות הופעלה אך מדיניות: חסום");
  if (form.allow_inbound_delete && PROTECTED_ENTITY_TYPES.includes(form.entity_type ?? ""))
    blockers.push(`מחיקה נכנסת אסורה עבור ישות '${form.entity_type}'`);
  return blockers;
}

function TargetForm({
  initial, onSave, onClose, isSaving, error,
}: {
  initial?: Partial<MondayTarget>;
  onSave: (data: Partial<MondayTarget>) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string | null;
}) {
  const [form, setForm] = useState<Partial<MondayTarget>>({ ...TARGET_DEFAULTS, ...initial });
  const set = (k: keyof MondayTarget, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const blockers = computeClientBlockers(form);
  const isProduction = form.environment === "production";

  return (
    <div className="space-y-4 py-2 overflow-y-auto max-h-[70vh] px-1" dir="rtl">
      <SectionHeading>הגדרות בסיסיות</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שם היעד *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" value={form.target_name ?? ""} onChange={(e) => set("target_name", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מפתח יעד *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background" value={form.target_key ?? ""} onChange={(e) => set("target_key", e.target.value)} placeholder="my_target" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סוג ישות *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.entity_type ?? ""} onChange={(e) => set("entity_type", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סביבת עבודה</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.environment ?? "test"} onChange={(e) => set("environment", e.target.value)}>
            <option value="test">בדיקות</option>
            <option value="production">ייצור</option>
          </select>
        </div>
      </div>
      {isProduction && (
        <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-orange-800">יעד ייצור — כל שינוי ישפיע על הנתונים האמיתיים. בדוק פעמיים לפני שמירה.</p>
        </div>
      )}

      <SectionHeading>הגדרות לוח Monday</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה לוח Monday *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_board_id ?? ""} onChange={(e) => set("monday_board_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שם הלוח הצפוי *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.board_name_expected ?? ""} onChange={(e) => set("board_name_expected", e.target.value)} placeholder={form.environment === "test" ? "TEST | שם הלוח" : ""} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה קבוצה</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_group_id ?? ""} onChange={(e) => set("monday_group_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה Workspace</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_workspace_id ?? ""} onChange={(e) => set("monday_workspace_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סדר ריצה</label>
          <input type="number" min={0} className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.sync_order ?? 0} onChange={(e) => set("sync_order", parseInt(e.target.value) || 0)} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-foreground/70 mb-1">מפתח שאילתת מקור</label>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.source_query_key ?? ""} onChange={(e) => set("source_query_key", e.target.value)} />
      </div>

      <SectionHeading>כיוון סנכרון</SectionHeading>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.outbound_enabled)} onChange={(e) => set("outbound_enabled", e.target.checked)} className="rounded" />
          <span>סנכרון מ-Supabase ל-Monday</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.inbound_enabled)} onChange={(e) => set("inbound_enabled", e.target.checked)} className="rounded" />
          <span>סנכרון מ-Monday ל-Supabase</span>
        </label>
      </div>

      <SectionHeading>הגדרות ייצוא (Supabase → Monday)</SectionHeading>
      <div className="flex flex-wrap gap-4">
        {(["create_enabled", "update_enabled", "delete_enabled", "skip_unchanged_enabled"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={Boolean(form[k])} onChange={(e) => set(k, e.target.checked)} className="rounded" />
            {k === "create_enabled" ? "יצירה" : k === "update_enabled" ? "עדכון" : k === "delete_enabled" ? "מחיקה" : "דלג ללא שינוי"}
          </label>
        ))}
      </div>

      <SectionHeading>הגדרות קליטה (Monday → Supabase)</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">תדירות בדיקה (שניות)</label>
          <input type="number" min={30} className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.polling_interval_seconds ?? 120} onChange={(e) => set("polling_interval_seconds", parseInt(e.target.value) || 120)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">חפיפה בין סריקות (שניות)</label>
          <input type="number" min={0} className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.polling_overlap_seconds ?? 300} onChange={(e) => set("polling_overlap_seconds", parseInt(e.target.value) || 300)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מדיניות יצירת רשומות</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.inbound_create_policy ?? "reject"} onChange={(e) => set("inbound_create_policy", e.target.value)}>
            {Object.entries(CREATE_POLICY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">טיפול בפריט לא מקושר</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.inbound_missing_link_policy ?? "review"} onChange={(e) => set("inbound_missing_link_policy", e.target.value)}>
            {Object.entries(MISSING_LINK_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.allow_inbound_create)} onChange={(e) => set("allow_inbound_create", e.target.checked)} className="rounded" />
          אפשר יצירת רשומות מ-Monday
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.allow_inbound_archive)} onChange={(e) => set("allow_inbound_archive", e.target.checked)} className="rounded" />
          אפשר ארכוב מ-Monday
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.allow_inbound_delete)} onChange={(e) => set("allow_inbound_delete", e.target.checked)} className="rounded" />
          אפשר מחיקה מ-Monday
        </label>
      </div>

      <SectionHeading>מצב</SectionHeading>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
        יעד פעיל
      </label>

      {blockers.length > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-yellow-800">בדיקת מוכנות מקומית — חסמים שנמצאו:</p>
          {blockers.map((b, i) => (
            <p key={i} className="text-xs text-yellow-700 flex items-start gap-1.5"><AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{b}</p>
          ))}
        </div>
      )}

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
  const [activateBlockers, setActivateBlockers] = useState<{ name: string; blockers: string[] } | null>(null);

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monday-targets"] }); setEditTarget(null); },
    onError: (e) => setFormError((e as Error).message),
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      authedFetch(`/api/monday/targets/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monday-targets"] }),
    onError: async (e: unknown, vars) => {
      const msg = (e as Error).message ?? "";
      // Try to extract blockers from error
      const raw = msg.includes("חסמי") ? msg : "";
      if (raw || msg.includes("לא ניתן")) {
        const t = targets.find((x) => x.id === vars.id);
        // Re-fetch to get structured blockers
        try {
          const res = await fetch(`${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api/monday/targets/${vars.id}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const body = await res.json().catch(() => ({}));
          const bl = (body as { blockers?: string[] }).blockers ?? [msg];
          setActivateBlockers({ name: t?.target_name ?? "יעד", blockers: bl });
        } catch {
          setActivateBlockers({ name: t?.target_name ?? "יעד", blockers: [msg] });
        }
      }
    },
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

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">סביבה</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">לוח Monday</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם לוח צפוי</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground">יוצא</th>
              <th className="text-center px-3 py-3 font-medium text-muted-foreground">נכנס</th>
              <th className="text-right px-3 py-3 font-medium text-muted-foreground">Polling</th>
              <th className="text-right px-4 py-3 font-medium text-muted-foreground">מצב</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {targets.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">אין יעדים. לחץ "יצירת יעד" להוספה.</td></tr>
            )}
            {targets.map((t) => {
              const status = computeTargetStatus(t);
              const envCls = t.environment === "production" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700";
              return (
                <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{t.target_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{t.target_key}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${envCls}`}>
                      {ENV_LABELS[t.environment ?? "test"] ?? t.environment}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.monday_board_id}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{t.board_name_expected ?? "—"}</td>
                  <td className="px-3 py-3 text-center">{t.outbound_enabled ? <CheckCircle className="w-4 h-4 text-green-600 mx-auto" /> : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-3 py-3 text-center">{t.inbound_enabled ? <CheckCircle className="w-4 h-4 text-purple-600 mx-auto" /> : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{t.inbound_enabled ? `${t.polling_interval_seconds ?? 120}ש׳` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        dir="ltr"
                        onClick={() => actionMutation.mutate({ id: t.id, action: t.is_active ? "deactivate" : "activate" })}
                        title={t.is_active ? "לחץ לכיבוי" : "לחץ להפעלה"}
                        disabled={actionMutation.isPending}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${t.is_active ? "bg-green-500" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${t.is_active ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                      <TargetStatusBadge status={status} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { setIsNew(false); setEditTarget(t); setFormError(null); }} title="עריכה" className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => actionMutation.mutate({ id: t.id, action: "duplicate" })} title="שכפול" className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { if (confirm("למחוק יעד זה?")) deleteMutation.mutate(t.id); }} title="מחיקה" className="p-1.5 rounded hover:bg-muted/60 text-red-500 hover:text-red-700 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit / Create dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNew ? "יצירת יעד חדש" : `עריכת יעד — ${editTarget?.target_name ?? ""}`}</DialogTitle>
          </DialogHeader>
          {editTarget !== null && (
            <TargetForm
              initial={editTarget}
              onSave={(d) => saveMutation.mutate(d)}
              onClose={() => setEditTarget(null)}
              isSaving={saveMutation.isPending}
              error={formError}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Activation blockers dialog */}
      <Dialog open={activateBlockers !== null} onOpenChange={(o) => !o && setActivateBlockers(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>לא ניתן להפעיל — {activateBlockers?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-sm text-muted-foreground">בדיקת מוכנות מקומית מצאה את הבעיות הבאות:</p>
            {activateBlockers?.blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800">{b}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-1">תקן את ההגדרות ונסה שוב.</p>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setActivateBlockers(null)} className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors">סגור</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Mapping Form ──────────────────────────────────────────────────────────────

const PROTECTED_FIELDS = [
  "amount", "total", "vat", "price", "payment", "approved", "locked", "immutable", "snapshot",
];

function fieldIsProtected(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return PROTECTED_FIELDS.some((p) => lower.includes(p));
}

function MappingForm({
  initial, onSave, onClose, isSaving, error,
}: {
  initial: Partial<MondayMapping>;
  onSave: (data: Partial<MondayMapping>) => void;
  onClose: () => void;
  isSaving: boolean;
  error?: string | null;
}) {
  const [form, setForm] = useState<Partial<MondayMapping>>({
    monday_column_id: "", monday_column_name: "", source_field: "",
    value_type: "text", transform_type: "identity",
    required: false, default_value: "", sync_order: 0, is_active: true,
    sync_direction: "supabase_to_monday", field_authority: "supabase",
    conflict_policy: "authority_wins", is_sensitive: false,
    allow_null_inbound: false, allow_null_outbound: false,
    ...initial,
  });
  const set = (k: keyof MondayMapping, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const isInbound = form.sync_direction === "monday_to_supabase" || form.sync_direction === "bidirectional";
  const isOutbound = form.sync_direction === "supabase_to_monday" || form.sync_direction === "bidirectional";
  const isBidir = form.sync_direction === "bidirectional";

  const warnings: string[] = [];
  if (form.conflict_policy === "latest_wins") warnings.push("מדיניות 'העדכון האחרון מנצח' עלולה לגרום לאובדן נתונים — השתמש בזהירות.");
  if (form.field_authority === "monday" && form.conflict_policy === "supabase_wins") warnings.push("שדה שמוגדר כ-Monday authoritative אך מדיניות ההתנגשות מחזיקה Supabase — סתירה אפשרית.");
  if (form.field_authority === "supabase" && form.conflict_policy === "monday_wins") warnings.push("שדה שמוגדר כ-Supabase authoritative אך מדיניות ההתנגשות מחזיקה Monday — סתירה אפשרית.");
  if (fieldIsProtected(form.source_field ?? "") && form.conflict_policy === "latest_wins") warnings.push("שדה פיננסי/מוגן לא יכול להשתמש ב-latest_wins — בחר מדיניות בטוחה יותר.");

  return (
    <div className="space-y-4 py-2 overflow-y-auto max-h-[70vh] px-1" dir="rtl">
      <SectionHeading>שדות</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שדה Supabase *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.source_field ?? ""} onChange={(e) => set("source_field", e.target.value)} placeholder="deal.status" />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">שם עמודת Monday</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_column_name ?? ""} onChange={(e) => set("monday_column_name", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מזהה עמודת Monday *</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.monday_column_id ?? ""} onChange={(e) => set("monday_column_id", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סוג עמודת Monday</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.value_type ?? "text"} onChange={(e) => set("value_type", e.target.value)}>
            {VALUE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">ערך ברירת מחדל</label>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.default_value ?? ""} onChange={(e) => set("default_value", e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">סדר</label>
          <input type="number" min={0} className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.sync_order ?? 0} onChange={(e) => set("sync_order", parseInt(e.target.value) || 0)} />
        </div>
      </div>

      <SectionHeading>כיוון וסמכות</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">כיוון סנכרון</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.sync_direction ?? "supabase_to_monday"} onChange={(e) => set("sync_direction", e.target.value)}>
            {Object.entries(DIRECTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {isBidir && (
          <div>
            <label className="block text-xs font-medium text-foreground/70 mb-1">בעלות על השדה</label>
            <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.field_authority ?? "supabase"} onChange={(e) => set("field_authority", e.target.value)}>
              {Object.entries(AUTHORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
      </div>
      {isBidir && (
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">מדיניות התנגשות</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.conflict_policy ?? "authority_wins"} onChange={(e) => set("conflict_policy", e.target.value)}>
            {Object.entries(CONFLICT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}

      <SectionHeading>טרנספורמציות</SectionHeading>
      {isOutbound && (
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">טרנספורמציה יוצאת (Supabase → Monday)</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.outbound_transform_type ?? form.transform_type ?? "identity"}
            onChange={(e) => { set("outbound_transform_type", e.target.value); set("transform_type", e.target.value); }}>
            {TRANSFORM_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
      )}
      {isInbound && (
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1">טרנספורמציה נכנסת (Monday → Supabase)</label>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500" value={form.inbound_transform_type ?? "identity"} onChange={(e) => set("inbound_transform_type", e.target.value)}>
            {TRANSFORM_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
      )}

      <SectionHeading>הגדרות נוספות</SectionHeading>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.required)} onChange={(e) => set("required", e.target.checked)} className="rounded" />
          שדה חובה
        </label>
        {isInbound && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={Boolean(form.allow_null_inbound)} onChange={(e) => set("allow_null_inbound", e.target.checked)} className="rounded" />
            אפשר NULL נכנס
          </label>
        )}
        {isOutbound && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={Boolean(form.allow_null_outbound)} onChange={(e) => set("allow_null_outbound", e.target.checked)} className="rounded" />
            אפשר NULL יוצא
          </label>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_sensitive)} onChange={(e) => set("is_sensitive", e.target.checked)} className="rounded" />
          <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          שדה רגיש
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={Boolean(form.is_active)} onChange={(e) => set("is_active", e.target.checked)} className="rounded" />
          פעיל
        </label>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-yellow-800 flex items-start gap-1.5"><AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{w}</p>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors">ביטול</button>
        <button type="button" disabled={isSaving} onClick={() => onSave(form)} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors">{isSaving ? "שומר..." : "שמור"}</button>
      </div>
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monday-mappings", selectedTarget?.id] }); setEditMapping(null); },
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
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-foreground/70 mb-1.5">בחר יעד</label>
          <select
            className="rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px]"
            value={selectedTarget?.id ?? ""}
            onChange={(e) => { const t = targets.find((x) => x.id === e.target.value); setSelectedTarget(t ?? null); }}
          >
            <option value="">-- בחר יעד --</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.target_name} — {ENV_LABELS[t.environment ?? "test"] ?? t.environment}</option>
            ))}
          </select>
        </div>
        {selectedTarget && (
          <div className="flex items-end gap-2 pb-0.5">
            <span className="text-sm text-muted-foreground">{mappings.length} מיפויים</span>
            <button onClick={() => { setIsNew(true); setEditMapping({}); setFormError(null); }} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
              <Plus className="w-4 h-4" /> יצירת מיפוי
            </button>
          </div>
        )}
      </div>

      {!selectedTarget && (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
          <ArrowRightLeft className="w-8 h-8 opacity-30" />
          <p className="text-sm">בחר יעד לצפייה ועריכת מיפויי השדות</p>
        </div>
      )}

      {selectedTarget && (
        <>
          {loadingMappings ? (
            <p className="text-sm text-muted-foreground py-4 text-center">טוען מיפויים...</p>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">סדר</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שדה Supabase</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">עמודת Monday</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">כיוון</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">בעלות</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">התנגשות</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">המרה יוצאת</th>
                    <th className="text-center px-3 py-3 font-medium text-muted-foreground">רגיש</th>
                    <th className="text-right px-3 py-3 font-medium text-muted-foreground">סטטוס</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {mappings.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground text-sm">אין מיפויים ליעד זה. לחץ "יצירת מיפוי" להוספה.</td></tr>
                  )}
                  {mappings.map((m) => {
                    const effectiveTransform = m.outbound_transform_type ?? m.transform_type ?? "identity";
                    return (
                      <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-3 text-center text-muted-foreground">{m.sync_order}</td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{m.source_field}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground text-xs">{m.monday_column_name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.monday_column_id}</p>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <SyncDirIcon dir={m.sync_direction} />
                            <span className="text-xs text-muted-foreground hidden xl:inline">{DIRECTION_LABELS[m.sync_direction ?? "supabase_to_monday"]}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{m.field_authority ? AUTHORITY_LABELS[m.field_authority] : "—"}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{m.conflict_policy ? CONFLICT_LABELS[m.conflict_policy] : "—"}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{TRANSFORM_TYPES.find((t) => t.value === effectiveTransform)?.label ?? effectiveTransform}</td>
                        <td className="px-3 py-3 text-center">{m.is_sensitive ? <Shield className="w-3.5 h-3.5 text-orange-500 mx-auto" /> : <span className="text-muted-foreground text-xs">—</span>}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                            {m.is_active ? "פעיל" : "כבוי"}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog open={editMapping !== null} onOpenChange={(o) => !o && setEditMapping(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNew ? "יצירת מיפוי" : `עריכת מיפוי — ${editMapping?.monday_column_name ?? ""}`}</DialogTitle>
          </DialogHeader>
          {editMapping !== null && (
            <MappingForm
              initial={editMapping}
              onSave={(d) => saveMutation.mutate(d)}
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

// ── Tab: Polling Monitor ──────────────────────────────────────────────────────

function PollingTab({ authedFetch }: { authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const { data, isLoading, refetch, isError, error } = useQuery<{ health: HealthRow[]; summary: HealthSummary }>({
    queryKey: ["monday-health"],
    queryFn: () => authedFetch("/api/monday/health"),
    refetchInterval: 30_000,
  });

  // Pause auto-refresh when tab hidden
  useEffect(() => {
    const handler = () => { /* react-query handles this via focus */ };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const health = data?.health ?? [];
  const summary = data?.summary;

  const pollingStatusCls: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    running: "bg-blue-100 text-blue-700",
    waiting: "bg-yellow-100 text-yellow-700",
    failed: "bg-red-100 text-red-700",
    disabled: "bg-muted text-muted-foreground",
  };

  if (isError) {
    const errMsg = (error as Error)?.message ?? "";
    const isTableMissing = errMsg.includes("relation") || errMsg.includes("does not exist");
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <AlertCircle className="w-8 h-8 text-orange-500" />
        <p className="font-medium text-foreground">{isTableMissing ? "טבלת הניטור טרם הוגדרה" : "שגיאה בטעינת נתוני ניטור"}</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {isTableMissing
            ? "הטבלה monday_sync_health_overview לא נמצאה. יש להריץ את מיגרציית הסכמה תחילה."
            : errMsg}
        </p>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-1">
          <RefreshCw className="w-4 h-4" /> נסה שוב
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">סיכום</h3>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} /> רענן
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "יעדים פעילים", value: summary?.active_targets ?? 0, icon: <Activity className="w-4 h-4 text-green-600" />, cls: "text-green-700" },
          { label: "Polling פעיל", value: summary?.polling_active ?? 0, icon: <Clock className="w-4 h-4 text-blue-600" />, cls: "text-blue-700" },
          { label: "אירועים ממתינים", value: summary?.pending_events ?? 0, icon: <Info className="w-4 h-4 text-yellow-600" />, cls: "text-yellow-700" },
          { label: "אירועים שנכשלו", value: summary?.failed_events ?? 0, icon: <AlertCircle className="w-4 h-4 text-red-500" />, cls: "text-red-700" },
          { label: "התנגשויות פתוחות", value: summary?.open_conflicts ?? 0, icon: <AlertCircle className="w-4 h-4 text-orange-500" />, cls: "text-orange-700" },
        ].map((card) => (
          <div key={card.label} className="bg-card border border-border rounded-xl px-4 py-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{card.icon}{card.label}</div>
            <p className={`text-2xl font-bold ${card.cls}`}>{isLoading ? "..." : card.value}</p>
          </div>
        ))}
      </div>

      {/* Health table */}
      {isLoading && health.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">טוען נתוני ניטור...</p>
      ) : health.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-muted-foreground">
          <Activity className="w-8 h-8 opacity-30" />
          <p className="text-sm">אין נתוני ניטור. יש להפעיל יעדים עם Polling כדי לראות נתונים.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">יעד</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">סביבה</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">לוח Monday</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">מצב Polling</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">סריקה אחרונה</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">סנכרון מוצלח</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">סריקה הבאה</th>
                <th className="text-center px-3 py-3 font-medium text-muted-foreground">כישלונות</th>
                <th className="text-center px-3 py-3 font-medium text-muted-foreground">ממתינים</th>
                <th className="text-center px-3 py-3 font-medium text-muted-foreground">נכשלו</th>
                <th className="text-center px-3 py-3 font-medium text-muted-foreground">התנגשויות</th>
                <th className="text-right px-3 py-3 font-medium text-muted-foreground">שגיאה</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {health.map((row) => {
                const ps = row.polling_status ?? "disabled";
                return (
                  <tr key={row.target_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{row.target_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.target_key}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${row.environment === "production" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700"}`}>
                        {ENV_LABELS[row.environment] ?? row.environment}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{row.monday_board_id}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${pollingStatusCls[ps] ?? "bg-muted text-muted-foreground"}`}>
                        {POLLING_STATUS_LABELS[ps] ?? ps}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.last_poll_completed_at)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.last_successful_sync_at)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.next_poll_at)}</td>
                    <td className="px-3 py-3 text-center">
                      {(row.consecutive_failures ?? 0) > 0
                        ? <span className="text-xs font-medium text-red-600">{row.consecutive_failures}</span>
                        : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center text-xs text-muted-foreground">{row.pending_events ?? 0}</td>
                    <td className="px-3 py-3 text-center">
                      {(row.failed_events ?? 0) > 0
                        ? <span className="text-xs font-medium text-red-600">{row.failed_events}</span>
                        : <span className="text-muted-foreground text-xs">0</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {(row.open_conflicts ?? 0) > 0
                        ? <span className="text-xs font-medium text-orange-600">{row.open_conflicts}</span>
                        : <span className="text-muted-foreground text-xs">0</span>}
                    </td>
                    <td className="px-3 py-3 text-xs text-red-600 max-w-[140px] truncate" title={row.last_error_code}>
                      {row.last_error_code ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground text-center">מתרענן אוטומטית כל 30 שניות</p>
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
  { key: "polling", label: "ניטור Polling" },
  { key: "runs", label: "ריצות" },
  { key: "validate", label: "בדיקת הגדרות" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function MondaySettings() {
  const authedFetch = useAuthedFetch();
  const [activeTab, setActiveTab] = useState<TabKey>("targets");

  return (
    <Shell title="סנכרון Monday">
      <div className="p-6 space-y-6 overflow-auto h-full" dir="rtl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/settings"><a className="hover:text-foreground transition-colors">הגדרות</a></Link>
          <ChevronRight className="w-4 h-4 rotate-180" />
          <span className="text-foreground">סנכרון Monday</span>
        </div>

        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
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
          {activeTab === "polling" && <PollingTab authedFetch={authedFetch} />}
          {activeTab === "runs" && <RunsTab authedFetch={authedFetch} />}
          {activeTab === "validate" && <ValidateTab authedFetch={authedFetch} />}
        </div>
      </div>
    </Shell>
  );
}
