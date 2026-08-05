import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import { ChevronRight, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from "lucide-react";

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

interface RunDetail {
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
  last_heartbeat_at?: string;
  parent_run_id?: string;
  requested_by?: string;
  error_code?: string;
  error_message?: string;
  error_details?: unknown;
  result_summary?: unknown;
  execution_context?: unknown;
}

interface RunStep {
  id: string;
  step_order: number;
  step_name: string;
  target_name?: string;
  status: string;
  total_records?: number;
  processed_count?: number;
  created_count?: number;
  updated_count?: number;
  skipped_count?: number;
  failed_count?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  input_snapshot?: unknown;
  output_summary?: unknown;
  error_details?: unknown;
}

interface RunItem {
  id: string;
  entity_type?: string;
  source_record_id?: string;
  target_name?: string;
  operation?: string;
  status: string;
  monday_board_id?: string;
  monday_item_id?: string;
  attempts?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  request_payload?: unknown;
  response_payload?: unknown;
  error_details?: unknown;
  source_hash?: string;
  idempotency_key?: string;
}

interface RunLog {
  id: string;
  created_at: string;
  level: string;
  event_type?: string;
  message: string;
  step_id?: string;
  item_id?: string;
  details?: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין", queued: "בתור", running: "פועל", waiting: "ממתין להמשך",
  completed: "הושלם", completed_with_warnings: "הושלם עם אזהרות",
  failed: "נכשל", cancelled: "בוטל",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700", queued: "bg-blue-100 text-blue-700",
  running: "bg-blue-100 text-blue-700", waiting: "bg-orange-100 text-orange-700",
  completed: "bg-green-100 text-green-700", completed_with_warnings: "bg-yellow-100 text-yellow-700",
  failed: "bg-red-100 text-red-700", cancelled: "bg-muted text-muted-foreground",
};

const LOG_LEVEL_LABELS: Record<string, string> = {
  debug: "דיבאג", info: "מידע", warning: "אזהרה", error: "שגיאה",
};

const LOG_LEVEL_CLASSES: Record<string, string> = {
  debug: "text-muted-foreground", info: "text-blue-700", warning: "text-yellow-700", error: "text-red-700",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

function fmtDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  if (data === null || data === undefined) return null;
  return (
    <div>
      <button onClick={() => setOpen((p) => !p)} className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors">
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {label}
      </button>
      {open && (
        <pre className="mt-2 bg-muted/60 rounded-lg p-3 text-xs overflow-auto max-h-48 text-foreground/80 font-mono leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function SummaryTab({ run }: { run: RunDetail }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground/70">פרטי ריצה</h3>
          <div className="space-y-2 text-sm">
            {[
              ["מזהה ריצה", <span className="font-mono text-xs">{run.id}</span>],
              ["מס׳ ריצה", run.run_number],
              ["מזהה עסקה", run.deal_number ?? run.deal_id?.slice(0, 8)],
              ["סוג פעולה", run.action_type],
              ["סטטוס", <StatusBadge status={run.status} />],
              ["אחוז התקדמות", run.progress_percent != null ? `${run.progress_percent}%` : "—"],
              ["שלב נוכחי", run.current_step ?? "—"],
              ["יעד נוכחי", run.current_target ?? "—"],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground text-left">{v}</span>
              </div>
            ))}
            {run.parent_run_id && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">ריצת אב</span>
                <Link href={`/settings/monday/runs/${run.parent_run_id}`}>
                  <a className="text-xs font-mono text-blue-600 hover:underline">{run.parent_run_id.slice(0, 8)}…</a>
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground/70">תזמון ותוצאות</h3>
          <div className="space-y-2 text-sm">
            {[
              ["נוצרה", fmtDate(run.created_at)],
              ["התחילה", fmtDate(run.started_at)],
              ["הסתיימה", fmtDate(run.completed_at)],
              ["משך", fmtDuration(run.started_at, run.completed_at)],
              ["פעימה אחרונה", fmtDate(run.last_heartbeat_at)],
              ["נוצרו", run.created_count ?? "—"],
              ["עודכנו", run.updated_count ?? "—"],
              ["דולגו", run.skipped_count ?? "—"],
              ["נכשלו", run.failed_count ?? "—"],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {run.error_message && (
        <div className="bg-destructive/10 border border-red-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-red-800 mb-1">שגיאה{run.error_code ? ` (${run.error_code})` : ""}</p>
          <p className="text-sm text-red-700">{run.error_message}</p>
        </div>
      )}
    </div>
  );
}

function StepsTab({ runId, authedFetch }: { runId: string; authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading } = useQuery<{ steps: RunStep[] }>({
    queryKey: ["monday-run-steps", runId],
    queryFn: () => authedFetch(`/api/monday/runs/${runId}/steps`),
  });
  const steps = data?.steps ?? [];

  const toggle = (id: string) => setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

  if (isLoading) return <p className="text-sm text-muted-foreground py-4">טוען שלבים...</p>;

  return (
    <div className="space-y-3">
      {steps.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">אין שלבים לריצה זו</p>}
      {steps.map((s) => (
        <div key={s.id} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggle(s.id)}>
            <span className="text-xs font-mono text-muted-foreground w-6">{s.step_order}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{s.step_name}</p>
              {s.target_name && <p className="text-xs text-muted-foreground">{s.target_name}</p>}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {s.created_count != null && <span>נוצרו: {s.created_count}</span>}
              {s.updated_count != null && <span>עודכנו: {s.updated_count}</span>}
              {s.failed_count != null && s.failed_count > 0 && <span className="text-red-600">נכשלו: {s.failed_count}</span>}
              <span className="text-muted-foreground">{fmtDuration(s.started_at, s.completed_at)}</span>
            </div>
            <StatusBadge status={s.status} />
            {expanded.has(s.id) ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
          {expanded.has(s.id) && (
            <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/20">
              {s.error && <p className="text-xs text-red-700 bg-destructive/10 rounded px-2 py-1">{s.error}</p>}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>סה״כ: {s.total_records ?? "—"}</span>
                <span>עובדו: {s.processed_count ?? "—"}</span>
                <span>דולגו: {s.skipped_count ?? "—"}</span>
              </div>
              <div className="flex gap-4">
                <JsonViewer data={s.input_snapshot} label="נתוני קלט" />
                <JsonViewer data={s.output_summary} label="סיכום פלט" />
                <JsonViewer data={s.error_details} label="פרטי שגיאה" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemsTab({ runId, authedFetch }: { runId: string; authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ status: "", failed_only: "" });

  const { data, isLoading } = useQuery<{ items: RunItem[] }>({
    queryKey: ["monday-run-items", runId, filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.failed_only === "true") params.set("failed_only", "true");
      return authedFetch(`/api/monday/runs/${runId}/items?${params.toString()}`);
    },
  });
  const items = data?.items ?? [];
  const toggle = (id: string) => setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select className="rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">כל הסטטוסים</option>
          {["pending", "running", "completed", "failed", "skipped"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={filters.failed_only === "true"} onChange={(e) => setFilters((p) => ({ ...p, failed_only: e.target.checked ? "true" : "" }))} className="rounded" />
          נכשלו בלבד
        </label>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">טוען רשומות...</p>}

      {!isLoading && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג ישות</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">מקור</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">יעד</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">פעולה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">ניסיונות</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">לא נמצאו רשומות</td></tr>}
              {items.map((item) => (
                <>
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">{item.entity_type ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.source_record_id?.slice(0, 8) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.target_name ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.operation ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{item.attempts ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {item.monday_board_id && item.monday_item_id && (
                          <a href={`https://monday.com/boards/${item.monday_board_id}/pulses/${item.monday_item_id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" /> פתח ב-Monday
                          </a>
                        )}
                        <button onClick={() => toggle(item.id)} className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground transition-colors">
                          {expanded.has(item.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded.has(item.id) && (
                    <tr key={`${item.id}-expanded`}>
                      <td colSpan={7} className="px-4 py-3 bg-muted/20 border-t border-border/50">
                        {item.error && <p className="text-xs text-red-700 bg-destructive/10 rounded px-2 py-1 mb-2">{item.error}</p>}
                        <div className="flex flex-wrap gap-4">
                          <JsonViewer data={item.request_payload} label="בקשה" />
                          <JsonViewer data={item.response_payload} label="תגובה" />
                          <JsonViewer data={item.error_details} label="פרטי שגיאה" />
                        </div>
                        {item.idempotency_key && <p className="text-xs text-muted-foreground mt-2 font-mono">מפתח: {item.idempotency_key}</p>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogsTab({ runId, authedFetch }: { runId: string; authedFetch: ReturnType<typeof useAuthedFetch> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ level: "", search: "" });

  const { data, isLoading } = useQuery<{ logs: RunLog[] }>({
    queryKey: ["monday-run-logs", runId, filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.level) params.set("level", filters.level);
      if (filters.search) params.set("search", filters.search);
      return authedFetch(`/api/monday/runs/${runId}/logs?${params.toString()}`);
    },
  });
  const logs = data?.logs ?? [];
  const toggle = (id: string) => setExpanded((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select className="rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none" value={filters.level} onChange={(e) => setFilters((p) => ({ ...p, level: e.target.value }))}>
          <option value="">כל הרמות</option>
          {Object.entries(LOG_LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          type="text"
          placeholder="חיפוש בלוגים..."
          className="rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">טוען לוגים...</p>}

      {!isLoading && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">שעה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">רמה</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">סוג אירוע</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">הודעה</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {logs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">לא נמצאו לוגים</td></tr>}
              {logs.map((log) => (
                <>
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap font-mono">{fmtDate(log.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold ${LOG_LEVEL_CLASSES[log.level] ?? "text-muted-foreground"}`}>
                        {LOG_LEVEL_LABELS[log.level] ?? log.level}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{log.event_type ?? "—"}</td>
                    <td className="px-4 py-2.5 text-foreground text-xs">{log.message}</td>
                    <td className="px-4 py-2.5">
                      {log.details != null && (
                        <button onClick={() => toggle(log.id)} className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground transition-colors">
                          {expanded.has(log.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded.has(log.id) && (
                    <tr key={`${log.id}-expanded`}>
                      <td colSpan={5} className="px-4 py-3 bg-muted/20 border-t border-border/50">
                        <pre className="text-xs font-mono text-foreground/80 overflow-auto max-h-32">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExecutionDataTab({ run }: { run: RunDetail }) {
  const safe = (data: unknown) => {
    if (!data || typeof data !== "object") return data;
    const d = { ...(data as Record<string, unknown>) };
    for (const k of ["secret", "token", "password", "authorization", "webhook_secret"]) {
      delete d[k];
    }
    return d;
  };

  return (
    <div className="space-y-4">
      {!!run.execution_context && (
        <div>
          <h3 className="text-sm font-semibold text-foreground/70 mb-2">הקשר ביצוע</h3>
          <pre className="bg-muted/60 rounded-xl p-4 text-xs font-mono text-foreground/80 overflow-auto max-h-64">
            {JSON.stringify(safe(run.execution_context), null, 2)}
          </pre>
        </div>
      )}
      {!!run.result_summary && (
        <div>
          <h3 className="text-sm font-semibold text-foreground/70 mb-2">סיכום תוצאות</h3>
          <pre className="bg-muted/60 rounded-xl p-4 text-xs font-mono text-foreground/80 overflow-auto max-h-64">
            {JSON.stringify(safe(run.result_summary), null, 2)}
          </pre>
        </div>
      )}
      {!!run.error_details && (
        <div>
          <h3 className="text-sm font-semibold text-foreground/70 mb-2">פרטי שגיאה</h3>
          <pre className="bg-destructive/10 border border-red-200 rounded-xl p-4 text-xs font-mono text-red-800 overflow-auto max-h-64">
            {JSON.stringify(safe(run.error_details), null, 2)}
          </pre>
        </div>
      )}
      {!run.execution_context && !run.result_summary && !run.error_details && (
        <p className="text-sm text-muted-foreground py-4">אין נתוני ביצוע זמינים</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: "summary", label: "סיכום" },
  { key: "steps", label: "שלבים" },
  { key: "items", label: "רשומות" },
  { key: "logs", label: "לוגים" },
  { key: "execution", label: "נתוני ביצוע" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const ACTIVE_STATUSES = ["pending", "queued", "running", "waiting"];
const RETRY_STATUSES = ["failed", "completed_with_warnings", "completed"];
const RESUME_STATUSES = ["failed", "waiting"];

export default function MondayRunDetail() {
  const { id } = useParams<{ id: string }>();
  const authedFetch = useAuthedFetch();
  const [activeTab, setActiveTab] = useState<TabKey>("summary");

  const { data, isLoading, isError, refetch } = useQuery<{ run: RunDetail }>({
    queryKey: ["monday-run", id],
    queryFn: () => authedFetch(`/api/monday/runs/${id}`),
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      if (!run) return false;
      return ACTIVE_STATUSES.includes(run.status) ? 5000 : false;
    },
  });

  const actionMutation = useMutation({
    mutationFn: (action: string) => authedFetch(`/api/monday/runs/${id}/${action}`, { method: "POST" }),
    onSuccess: () => refetch(),
    onError: (e) => alert((e as Error).message),
  });

  const run = data?.run;

  if (isLoading) {
    return (
      <Shell title="פרטי ריצה">
        <div className="flex items-center justify-center h-full">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </Shell>
    );
  }

  if (isError || !run) {
    return (
      <Shell title="פרטי ריצה">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-destructive">ריצה לא נמצאה</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={`ריצה #${run.run_number} — ${run.deal_number ?? run.deal_id?.slice(0, 8)}`}>
      <div className="p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <Link href="/settings"><a className="hover:text-foreground transition-colors">הגדרות</a></Link>
          <ChevronRight className="w-4 h-4" />
          <Link href="/settings/monday"><a className="hover:text-foreground transition-colors">Monday</a></Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground">ריצה #{run.run_number}</span>
          <StatusBadge status={run.status} />
        </div>

        {/* Actions bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refetch()} className="flex items-center gap-1.5 border border-border hover:bg-muted/60 text-muted-foreground text-sm rounded-lg px-3 py-2 transition-colors">
            <RefreshCw className="w-4 h-4" /> רענן
          </button>
          {RETRY_STATUSES.includes(run.status) && (
            <button disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("retry")} className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
              נסה שוב
            </button>
          )}
          {RESUME_STATUSES.includes(run.status) && (
            <button disabled={actionMutation.isPending} onClick={() => actionMutation.mutate("resume")} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg px-3 py-2 transition-colors">
              המשך
            </button>
          )}
          {ACTIVE_STATUSES.includes(run.status) && (
            <button disabled={actionMutation.isPending} onClick={() => { if (confirm("לבטל ריצה זו?")) actionMutation.mutate("cancel"); }} className="flex items-center gap-1.5 border border-red-300 hover:bg-red-500/10 text-red-600 text-sm font-medium rounded-lg px-3 py-2 transition-colors">
              בטל ריצה
            </button>
          )}
          {run.progress_percent != null && (
            <div className="flex items-center gap-2 mr-auto">
              <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${run.progress_percent}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">{run.progress_percent}%</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${activeTab === t.key ? "border-b-2 border-blue-600 text-blue-600" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === "summary" && <SummaryTab run={run} />}
          {activeTab === "steps" && <StepsTab runId={id!} authedFetch={authedFetch} />}
          {activeTab === "items" && <ItemsTab runId={id!} authedFetch={authedFetch} />}
          {activeTab === "logs" && <LogsTab runId={id!} authedFetch={authedFetch} />}
          {activeTab === "execution" && <ExecutionDataTab run={run} />}
        </div>
      </div>
    </Shell>
  );
}
