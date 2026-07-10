import { useMemo } from "react";
import { Users, Target, TrendingUp, CalendarClock, AlertCircle, CheckCircle2, Clock, Phone } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { useListLeads, useListCustomers } from "@workspace/api-client-react";
import type { Lead } from "@workspace/api-client-react";

// ---------- helpers ----------

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(val: string | null | undefined): string {
  const d = parseDate(val);
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// ---------- KPI Card ----------

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: "blue" | "green" | "orange" | "red" | "purple";
}

const ACCENT: Record<string, string> = {
  blue:   "bg-blue-50 border-blue-100 text-blue-600",
  green:  "bg-green-50 border-green-100 text-green-600",
  orange: "bg-orange-50 border-orange-100 text-orange-600",
  red:    "bg-red-50 border-red-100 text-red-600",
  purple: "bg-purple-50 border-purple-100 text-purple-600",
};

function KpiCard({ icon, label, value, sub, accent = "blue" }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex gap-4 items-start shadow-sm">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 border ${ACCENT[accent]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground font-medium mb-0.5">{label}</p>
        <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ---------- Status breakdown ----------

interface StatusBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

function StatusBar({ label, count, total, color }: StatusBarProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-32 shrink-0 truncate text-right">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-700 w-10 text-left shrink-0">{count}</span>
      <span className="text-xs text-muted-foreground w-8 shrink-0">{pct}%</span>
    </div>
  );
}

// ---------- Followup row ----------

function FollowupRow({ lead }: { lead: Lead }) {
  const isPast = (() => {
    const d = parseDate(lead.followup_at);
    return d ? d < new Date() : false;
  })();

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${isPast ? "bg-red-400" : "bg-orange-400"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
        {lead.followup_note && (
          <p className="text-xs text-muted-foreground truncate">{lead.followup_note}</p>
        )}
      </div>
      <div className="text-left shrink-0">
        <p className="text-xs text-muted-foreground">{formatDate(lead.followup_at)}</p>
        {lead.phone && (
          <a href={`tel:${lead.phone}`} className="text-xs text-blue-600 flex items-center gap-0.5 mt-0.5">
            <Phone className="w-2.5 h-2.5" />
            {lead.phone}
          </a>
        )}
      </div>
    </div>
  );
}

// ---------- Main ----------

export default function Dashboard() {
  const { data: leads = [], isLoading: leadsLoading } = useListLeads();
  const { data: customers = [], isLoading: customersLoading } = useListCustomers();

  const now = new Date();
  const monthStart = startOfMonth();
  const weekAhead = addDays(now, 7);

  const stats = useMemo(() => {
    const leadsThisMonth = leads.filter((l) => {
      const d = parseDate(l.lead_created_at);
      return d && d >= monthStart;
    });

    const followupSoon = leads
      .filter((l) => {
        const d = parseDate(l.followup_at);
        return d && d <= weekAhead;
      })
      .sort((a, b) => {
        const da = parseDate(a.followup_at)!.getTime();
        const db = parseDate(b.followup_at)!.getTime();
        return da - db;
      });

    const followupOverdue = followupSoon.filter((l) => {
      const d = parseDate(l.followup_at);
      return d && d < now;
    });

    const customersThisMonth = customers.filter((c) => {
      const d = parseDate(c.joined_at);
      return d && d >= monthStart;
    });

    // Status breakdown — top 6
    const statusCount: Record<string, number> = {};
    for (const l of leads) {
      const s = l.status ?? "לא מוגדר";
      statusCount[s] = (statusCount[s] ?? 0) + 1;
    }
    const topStatuses = Object.entries(statusCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Source breakdown — top 5
    const sourceCount: Record<string, number> = {};
    for (const l of leads) {
      const s = l.lead_source ?? "לא ידוע";
      sourceCount[s] = (sourceCount[s] ?? 0) + 1;
    }
    const topSources = Object.entries(sourceCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      totalLeads: leads.length,
      leadsThisMonth: leadsThisMonth.length,
      followupSoon: followupSoon.slice(0, 8),
      followupOverdue: followupOverdue.length,
      totalCustomers: customers.length,
      customersThisMonth: customersThisMonth.length,
      topStatuses,
      topSources,
    };
  }, [leads, customers]);

  const isLoading = leadsLoading || customersLoading;

  const STATUS_COLORS = [
    "bg-blue-500", "bg-green-500", "bg-orange-400",
    "bg-purple-500", "bg-red-400", "bg-gray-400",
  ];

  return (
    <Shell title="דשבורד">
      <div className="h-full overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">טוען נתוני דשבורד...</span>
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-6xl">

            {/* ── KPI row ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                icon={<Target className="w-5 h-5" />}
                label="סה״כ לידים"
                value={stats.totalLeads.toLocaleString("he-IL")}
                sub={`${stats.leadsThisMonth} חדשים החודש`}
                accent="blue"
              />
              <KpiCard
                icon={<Users className="w-5 h-5" />}
                label="לקוחות"
                value={stats.totalCustomers.toLocaleString("he-IL")}
                sub={`${stats.customersThisMonth} חדשים החודש`}
                accent="green"
              />
              <KpiCard
                icon={<CalendarClock className="w-5 h-5" />}
                label="פולואפ השבוע"
                value={stats.followupSoon.length}
                sub={stats.followupOverdue > 0 ? `${stats.followupOverdue} באיחור` : "הכל בזמן"}
                accent={stats.followupOverdue > 0 ? "red" : "orange"}
              />
              <KpiCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="לידים החודש"
                value={stats.leadsThisMonth}
                sub={`מתוך ${stats.totalLeads.toLocaleString("he-IL")} סה״כ`}
                accent="purple"
              />
            </div>

            {/* ── Middle row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Followup list */}
              <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 text-sm">פולואפים קרובים</h2>
                  <Badge variant={stats.followupOverdue > 0 ? "destructive" : "secondary"}>
                    {stats.followupSoon.length}
                  </Badge>
                </div>
                <div className="px-5 py-1 max-h-72 overflow-y-auto">
                  {stats.followupSoon.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      <CheckCircle2 className="w-8 h-8 text-green-400" />
                      <p className="text-sm">אין פולואפים השבוע</p>
                    </div>
                  ) : (
                    stats.followupSoon.map((lead) => (
                      <FollowupRow key={lead.id} lead={lead} />
                    ))
                  )}
                </div>
              </div>

              {/* Status breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 text-sm">לידים לפי סטטוס</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {stats.topStatuses.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">אין נתונים</p>
                  ) : (
                    stats.topStatuses.map(([status, count], i) => (
                      <StatusBar
                        key={status}
                        label={status}
                        count={count}
                        total={stats.totalLeads}
                        color={STATUS_COLORS[i % STATUS_COLORS.length]}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Source breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900 text-sm">לידים לפי מקור הגעה</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {stats.topSources.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">אין נתונים</p>
                  ) : (
                    stats.topSources.map(([source, count], i) => (
                      <StatusBar
                        key={source}
                        label={source}
                        count={count}
                        total={stats.totalLeads}
                        color={STATUS_COLORS[i % STATUS_COLORS.length]}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* ── Bottom alerts row ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">פולואפ באיחור</p>
                  <p className="text-2xl font-bold text-red-600">{stats.followupOverdue}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-3">
                <Clock className="w-5 h-5 text-orange-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">פולואפ 7 ימים הבאים</p>
                  <p className="text-2xl font-bold text-orange-600">{stats.followupSoon.length}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-900">לקוחות חדשים החודש</p>
                  <p className="text-2xl font-bold text-green-600">{stats.customersThisMonth}</p>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </Shell>
  );
}
