import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Shell } from "@/components/layout/shell";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Kpi {
  total_reviewed: number;
  avg_score: number | null;
  acceptance_rate: number | null;
  avg_match: number | null;
}

interface CategoryRow {
  category: string;
  cnt: number;
  avg_score: number | null;
  avg_confidence: number | null;
  acceptance_rate: number | null;
  avg_match: number | null;
}

interface Analytics {
  kpi: Kpi;
  by_category: CategoryRow[];
  score_dist: Array<{ score: number; cnt: number }>;
  by_action: Array<{ action: string; cnt: number; avg_score: number | null }>;
  by_day: Array<{ day: string; cnt: number; avg_score: number | null }>;
  conf_calib: Array<{ bucket: string; avg_score: number | null; cnt: number }>;
  needs_attention: Array<{
    id: number;
    customer_name: string | null;
    category: string | null;
    proposed_reply: string | null;
    editor_corrected_reply: string | null;
    match_score: number;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number | null) {
  return v != null ? `${v.toFixed(1)}%` : "—";
}
function score(v: number | null) {
  return v != null ? v.toFixed(1) : "—";
}

function scoreColor(v: number | null) {
  if (v == null) return "";
  if (v < 3) return "bg-red-100 text-red-700";
  if (v <= 4) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex-1 min-w-[140px]">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WhatsAppAnalytics() {
  const [days, setDays] = useState(30);

  const { data, isLoading, error } = useQuery<Analytics>({
    queryKey: ["wa-analytics", days],
    queryFn: () => apiFetch(`/api/whatsapp/analytics?days=${days}`),
  });

  // Fill missing scores 1-5
  const scoreDist = [1, 2, 3, 4, 5].map((s) => ({
    score: `${s} ★`,
    כמות: data?.score_dist.find((r) => r.score === s)?.cnt ?? 0,
    fill: SCORE_COLORS[s - 1],
  }));

  const actionLabels: Record<string, string> = {
    auto_reply: "תשובה אוטומטית",
    needs_human: "דרוש אנוש",
    ignore: "להתעלם",
  };

  return (
    <Shell title="אנליטיקה — וואטסאפ">
      {/* Back link + date range */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/production"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה לעורך
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">טווח:</span>
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "px-3 py-1 rounded-lg border transition-colors",
                days === d
                  ? "bg-gray-900 text-white border-gray-900"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              )}
            >
              {d} ימים
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-20 text-gray-400 text-sm">טוען נתונים...</div>
      )}
      {error && (
        <div className="text-center py-20 text-red-500 text-sm">
          שגיאה בטעינת אנליטיקה: {(error as Error).message}
        </div>
      )}
      {data && (
        <div className="space-y-8">

          {/* ── 1. KPI row ─────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              סיכום כולל
            </h2>
            <div className="flex flex-wrap gap-4">
              <KpiCard label="נבדקו" value={String(data.kpi.total_reviewed ?? 0)} />
              <KpiCard label="ממוצע דירוג" value={score(data.kpi.avg_score)} sub="1–5" />
              <KpiCard
                label="שיעור קבלה"
                value={pct(data.kpi.acceptance_rate)}
                sub="הסכמה ≥ 90% לתשובת AI"
              />
              <KpiCard
                label="דמיון ממוצע"
                value={data.kpi.avg_match != null ? pct(data.kpi.avg_match * 100) : "—"}
                sub="בין תשובת AI לתשובה הסופית"
              />
            </div>
          </section>

          {/* ── 2. Per-category table ───────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              לפי קטגוריה (ממוין לפי ממוצע דירוג — הגרוע ביותר ראשון)
            </h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {["קטגוריה", "כמות", "ממוצע דירוג", "ביטחון AI", "שיעור קבלה", "דמיון ממוצע"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-right font-medium text-gray-600 text-xs">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.by_category.map((row, i) => (
                    <tr key={row.category} className={cn("border-b border-gray-100", i % 2 === 1 ? "bg-gray-50/50" : "")}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{row.category}</td>
                      <td className="px-4 py-2.5 text-gray-600">{row.cnt}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", scoreColor(row.avg_score))}>
                          {score(row.avg_score)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{score(row.avg_confidence)}%</td>
                      <td className="px-4 py-2.5 text-gray-600">{pct(row.acceptance_rate)}</td>
                      <td className="px-4 py-2.5 text-gray-600">
                        {row.avg_match != null ? pct(row.avg_match * 100) : "—"}
                      </td>
                    </tr>
                  ))}
                  {data.by_category.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                        אין נתונים
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Charts row ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* 3. Score distribution */}
            <section className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                התפלגות דירוגים
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={scoreDist} barSize={36}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="score" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [`${v} הודעות`, ""]} />
                  <Bar dataKey="כמות" radius={[4, 4, 0, 0]}>
                    {scoreDist.map((entry, i) => (
                      <rect key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>

            {/* 4. By suggested_action */}
            <section className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                לפי פעולה מוצעת
              </h2>
              <div className="space-y-3">
                {data.by_action.map((row) => (
                  <div key={row.action} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      {actionLabels[row.action] ?? row.action}
                    </span>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500">{row.cnt} הודעות</span>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", scoreColor(row.avg_score))}>
                        ★ {score(row.avg_score)}
                      </span>
                    </div>
                  </div>
                ))}
                {data.by_action.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-4">אין נתונים</div>
                )}
              </div>
            </section>

          </div>

          {/* ── 5. Confidence calibration ────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              כיול ביטחון AI — האם ביטחון גבוה = דירוג גבוה?
            </h2>
            {data.conf_calib.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">אין נתונים</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.conf_calib} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}`, "ממוצע דירוג"]} />
                  <Bar dataKey="avg_score" name="ממוצע דירוג" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* ── 6. Trend over time ───────────────────────────────────────────── */}
          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              מגמה לאורך זמן
            </h2>
            {data.by_day.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">אין נתונים</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 5]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="cnt" name="כמות הודעות" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="avg_score" name="ממוצע דירוג" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* ── 7. Needs attention ──────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              דורש תשומת לב — 10 הפערים הגדולים ביותר בין AI לעורך
            </h2>
            <div className="space-y-3">
              {data.needs_attention.map((row) => (
                <div key={row.id} className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">
                      {row.customer_name ?? "לא ידוע"} · {row.category ?? "ללא קטגוריה"} ·{" "}
                      <span className="text-amber-600 font-medium">
                        דמיון {(row.match_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-xs font-medium text-gray-500 mb-1">תשובת AI:</div>
                    <div className="text-sm text-gray-700 bg-blue-50 rounded-lg p-2.5 leading-relaxed whitespace-pre-wrap">
                      {row.proposed_reply ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1 mt-5">תשובת העורך:</div>
                    <div className="text-sm text-gray-700 bg-amber-50 rounded-lg p-2.5 leading-relaxed whitespace-pre-wrap">
                      {row.editor_corrected_reply ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
              {data.needs_attention.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-8 bg-white border border-gray-200 rounded-xl">
                  אין נתונים להצגה
                </div>
              )}
            </div>
          </section>

        </div>
      )}
    </Shell>
  );
}
