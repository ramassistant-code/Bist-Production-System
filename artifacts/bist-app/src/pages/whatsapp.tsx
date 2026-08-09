import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Shell } from "@/components/layout/shell";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3, Star, Clock, CheckCircle2, ChevronLeft,
  AlertCircle, MessageCircle, RefreshCw,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Conversation {
  conv_id: string;
  customer_wa_id: string | null;
  customer_name: string | null;
  last_message: string | null;
  last_at: string | null;
  pending_count: number;
  total_count: number;
}

interface WaMessage {
  id: number;
  received_at: string;
  customer_wa_id: string | null;
  customer_name: string | null;
  message_type: string | null;
  message_text: string | null;
  media_url: string | null;
  category: string | null;
  subcategory: string | null;
  intent: string | null;
  sentiment: string | null;
  urgency: string | null;
  language: string | null;
  ai_analysis: string | null;
  proposed_reply: string | null;
  ai_confidence: number | null;
  suggested_action: string | null;
  editor_score: number | null;
  editor_corrected_reply: string | null;
  editor_notes: string | null;
  review_status: "pending" | "reviewed";
  reviewed_at: string | null;
}

interface Stats { pending: number; reviewed: number; avg_score: number | null }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function ActionBadge({ action }: { action: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    auto_reply:   { label: "תשובה אוטומטית", cls: "bg-green-900/60 text-green-300" },
    needs_human:  { label: "דרוש אנוש",      cls: "bg-amber-900/60 text-amber-300"  },
    ignore:       { label: "להתעלם",          cls: "bg-zinc-700 text-zinc-400"       },
  };
  const v = map[action ?? ""] ?? { label: action ?? "—", cls: "bg-zinc-700 text-zinc-400" };
  return (
    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", v.cls)}>
      {v.label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-500 w-8 text-left">{pct}%</span>
    </div>
  );
}

// ─── Star selector ────────────────────────────────────────────────────────────

function StarSelector({
  value, onChange, disabled,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(s)}
          className="p-0.5 focus:outline-none disabled:cursor-not-allowed"
        >
          <Star
            className={cn(
              "w-6 h-6 transition-colors",
              (hover || value) >= s ? "fill-amber-400 text-amber-400" : "text-zinc-600",
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Scoring form ─────────────────────────────────────────────────────────────

function ScoringCard({ msg, onSaved }: { msg: WaMessage; onSaved: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(msg.review_status === "pending");
  const [score, setScore] = useState(msg.editor_score ?? 0);
  const [reply, setReply] = useState(msg.editor_corrected_reply ?? msg.proposed_reply ?? "");
  const [notes, setNotes] = useState(msg.editor_notes ?? "");
  const cardRef = useRef<HTMLDivElement>(null);

  // Keyboard: 1-5 → set score; Ctrl+Enter → save
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (document.activeElement?.tagName === "TEXTAREA") {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSave();
        return;
      }
      if (e.key >= "1" && e.key <= "5") setScore(Number(e.key));
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSave();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, score, reply, notes]);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/whatsapp/messages/${msg.id}/review`, {
        method: "PATCH",
        body: { editor_score: score, editor_corrected_reply: reply, editor_notes: notes },
      }),
    onSuccess: () => {
      toast({ title: "נשמר בהצלחה ✓" });
      setEditing(false);
      onSaved();
    },
    onError: (err: Error) =>
      toast({ title: "שגיאה בשמירה", description: err.message, variant: "destructive" }),
  });

  function handleSave() {
    if (score < 1) {
      toast({ title: "יש לבחור דירוג (1–5)", variant: "destructive" });
      return;
    }
    mutation.mutate();
  }

  const isReviewed = !editing && msg.review_status === "reviewed";

  return (
    <div ref={cardRef} className="bg-zinc-800 border border-zinc-700 rounded-xl shadow-sm overflow-hidden">
      {/* AI Analysis */}
      <div className="bg-zinc-900 px-4 pt-4 pb-3 border-b border-zinc-700 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          {msg.category && (
            <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
              {msg.category}
            </span>
          )}
          {msg.subcategory && (
            <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
              {msg.subcategory}
            </span>
          )}
          {msg.sentiment && (
            <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">
              {msg.sentiment}
            </span>
          )}
          {msg.urgency && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              msg.urgency === "high" ? "bg-red-900/60 text-red-300" :
              msg.urgency === "medium" ? "bg-amber-900/60 text-amber-300" :
              "bg-zinc-700 text-zinc-400"
            )}>
              {msg.urgency === "high" ? "דחוף" : msg.urgency === "medium" ? "בינוני" : msg.urgency}
            </span>
          )}
          <ActionBadge action={msg.suggested_action} />
        </div>

        {msg.intent && (
          <div className="text-xs text-zinc-400">
            <span className="font-medium text-zinc-300">כוונה:</span> {msg.intent}
          </div>
        )}
        {msg.ai_analysis && (
          <div className="text-xs text-zinc-400 leading-relaxed">
            <span className="font-medium text-zinc-300">ניתוח AI:</span> {msg.ai_analysis}
          </div>
        )}
        <div>
          <div className="text-xs text-zinc-500 mb-1">ביטחון AI</div>
          <ConfidenceBar value={msg.ai_confidence} />
        </div>
      </div>

      {/* Proposed reply */}
      {msg.proposed_reply && (
        <div className="px-4 py-3 border-b border-zinc-700">
          <div className="text-xs font-medium text-zinc-500 mb-1">תשובה מוצעת (AI)</div>
          <div className="text-sm text-zinc-200 bg-secondary border border-border rounded-lg p-2.5 leading-relaxed whitespace-pre-wrap">
            {msg.proposed_reply}
          </div>
        </div>
      )}

      {/* Scoring form or reviewed state */}
      <div className="px-4 py-4">
        {isReviewed ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-400 font-medium">נבדק</span>
                {msg.reviewed_at && (
                  <span className="text-xs text-zinc-500">{fmtTime(msg.reviewed_at)}</span>
                )}
              </div>
              <button
                onClick={() => {
                  setScore(msg.editor_score ?? 0);
                  setReply(msg.editor_corrected_reply ?? msg.proposed_reply ?? "");
                  setNotes(msg.editor_notes ?? "");
                  setEditing(true);
                }}
                className="text-xs text-primary hover:underline"
              >
                ערוך
              </button>
            </div>
            <div className="flex gap-0.5">
              {[1,2,3,4,5].map((s) => (
                <Star key={s} className={cn("w-4 h-4", (msg.editor_score ?? 0) >= s ? "fill-amber-400 text-amber-400" : "text-zinc-700")} />
              ))}
            </div>
            {msg.editor_corrected_reply && msg.editor_corrected_reply !== msg.proposed_reply && (
              <div className="text-xs text-zinc-300 bg-amber-950/40 border border-amber-900/40 rounded-lg p-2 whitespace-pre-wrap">
                <span className="font-medium text-amber-400">תשובה מתוקנת: </span>
                {msg.editor_corrected_reply}
              </div>
            )}
            {msg.editor_notes && (
              <div className="text-xs text-zinc-500 italic">{msg.editor_notes}</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-1.5">דירוג (1–5 ★)</div>
              <StarSelector value={score} onChange={setScore} disabled={mutation.isPending} />
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-1">תשובה לשליחה (ניתן לערוך)</div>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                disabled={mutation.isPending}
                placeholder="השאר ריק לאשר את תשובת ה-AI..."
                className="w-full text-sm bg-zinc-900 border border-zinc-600 text-zinc-200 placeholder-zinc-600 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <div className="text-xs font-medium text-zinc-400 mb-1">הערות (אופציונלי)</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                disabled={mutation.isPending}
                placeholder="הערות לעצמך..."
                className="w-full text-sm bg-zinc-900 border border-zinc-600 text-zinc-200 placeholder-zinc-600 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-600">Ctrl+Enter לשמירה</span>
              <button
                onClick={handleSave}
                disabled={mutation.isPending || score < 1}
                className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {mutation.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
                שמור וסמן כנבדק
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, onSaved }: { msg: WaMessage; onSaved: () => void }) {
  return (
    <div className="space-y-2">
      {/* Incoming chat bubble */}
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div className="bg-zinc-700 border border-zinc-600 rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm">
            {msg.message_text ? (
              <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">{msg.message_text}</p>
            ) : (
              <p className="text-sm text-zinc-500 italic">הודעת מדיה</p>
            )}
          </div>
          <div className="text-xs text-zinc-600 mt-1 text-left px-1">{fmtTime(msg.received_at)}</div>
        </div>
      </div>
      {/* AI + Score card */}
      <ScoringCard msg={msg} onSaved={onSaved} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WhatsApp() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("all");
  const [category, setCategory] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Stats
  const { data: stats } = useQuery<Stats>({
    queryKey: ["wa-stats"],
    queryFn: () => apiFetch("/api/whatsapp/stats"),
    refetchInterval: 30_000,
  });

  // Categories
  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ["wa-categories"],
    queryFn: () => apiFetch("/api/whatsapp/categories"),
  });

  // Conversations
  const { data: conversations = [], isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: ["wa-conversations", filter, category],
    queryFn: () => {
      const p = new URLSearchParams({ filter });
      if (category) p.set("category", category);
      return apiFetch(`/api/whatsapp/conversations?${p}`);
    },
    refetchInterval: 30_000,
  });

  // Messages for selected conversation
  const { data: messages = [], isLoading: msgsLoading } = useQuery<WaMessage[]>({
    queryKey: ["wa-messages", selectedId],
    queryFn: () => apiFetch(`/api/whatsapp/conversations/${selectedId}`),
    enabled: !!selectedId,
  });

  // Auto-select first conversation
  useEffect(() => {
    if (conversations.length > 0 && !selectedId) {
      setSelectedId(conversations[0].conv_id);
    }
  }, [conversations, selectedId]);

  const handleSaved = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["wa-stats"] });
    qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    qc.invalidateQueries({ queryKey: ["wa-messages", selectedId] });
  }, [qc, selectedId]);

  const selectedConv = conversations.find((c) => c.conv_id === selectedId);

  return (
    <Shell title="וואטסאפ עורך" noPadding>
      <div className="flex flex-col h-full bg-zinc-950">

        {/* ── Top stats bar ───────────────────────────────────────────────── */}
        <div className="shrink-0 bg-zinc-900 border-b border-zinc-700 px-6 py-3 flex items-center gap-6 flex-wrap">
          {/* Counters */}
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-amber-400">{stats?.pending ?? "—"}</span>
              <span className="text-zinc-500">ממתינות</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="font-semibold text-green-400">{stats?.reviewed ?? "—"}</span>
              <span className="text-zinc-500">נבדקו</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span className="font-semibold text-zinc-200">{stats?.avg_score != null ? stats.avg_score.toFixed(1) : "—"}</span>
              <span className="text-zinc-500">ממוצע</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* Category filter */}
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setSelectedId(null); }}
            className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">כל הקטגוריות</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Filter toggle */}
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-sm">
            {(["pending", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setSelectedId(null); }}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  filter === f ? "bg-primary text-white" : "text-zinc-400 hover:bg-zinc-800"
                )}
              >
                {f === "pending" ? "ממתין לביקורת" : "הכל"}
              </button>
            ))}
          </div>

          {/* Analytics link */}
          <Link
            href="/production/analytics"
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            <span>אנליטיקה</span>
          </Link>
        </div>

        {/* ── Two-pane layout ─────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">

          {/* Conversations sidebar (right in RTL) */}
          <div className="w-80 shrink-0 border-l border-zinc-700 flex flex-col bg-zinc-900 overflow-y-auto">
            {convsLoading ? (
              <div className="p-6 text-sm text-zinc-500 text-center">טוען שיחות...</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <div className="text-4xl">🎉</div>
                <div className="text-sm text-zinc-500">אין הודעות שממתינות לביקורת</div>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.conv_id}
                  onClick={() => setSelectedId(conv.conv_id)}
                  className={cn(
                    "w-full text-right px-4 py-3.5 border-b border-zinc-800 hover:bg-zinc-800 transition-colors",
                    selectedId === conv.conv_id ? "bg-primary/10 border-r-2 border-r-primary" : ""
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-zinc-100 truncate">
                        {conv.customer_name || conv.conv_id}
                      </div>
                      <div className="text-xs text-zinc-500 truncate mt-0.5">
                        {conv.last_message ?? "הודעת מדיה"}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-xs text-zinc-600">{fmtTime(conv.last_at)}</span>
                      {conv.pending_count > 0 && (
                        <span className="bg-primary text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                          {conv.pending_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto bg-zinc-950">
            {!selectedId ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center space-y-2">
                  <MessageCircle className="w-12 h-12 mx-auto text-zinc-700" />
                  <p className="text-sm text-zinc-600">בחר שיחה מהרשימה</p>
                </div>
              </div>
            ) : msgsLoading ? (
              <div className="p-8 text-sm text-zinc-500 text-center">טוען הודעות...</div>
            ) : (
              <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
                {/* Conversation header */}
                <div className="flex items-center gap-3 pb-4 border-b border-zinc-800">
                  <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-lg font-bold text-zinc-300">
                    {(selectedConv?.customer_name || "?").charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-100">
                      {selectedConv?.customer_name || selectedId}
                    </div>
                    <div className="text-xs text-zinc-500">{selectedId}</div>
                  </div>
                  {selectedConv && selectedConv.pending_count > 0 && (
                    <span className="mr-auto text-xs bg-amber-900/50 text-amber-300 px-2.5 py-1 rounded-full font-medium">
                      {selectedConv.pending_count} ממתינות לביקורת
                    </span>
                  )}
                </div>

                {messages.length === 0 ? (
                  <div className="text-center text-sm text-zinc-600 py-12">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
                    לא נמצאו הודעות לשיחה זו
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} onSaved={handleSaved} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
