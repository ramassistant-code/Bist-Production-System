import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ClipboardList,
  Eye,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";

interface CoordinationTask {
  id: string;
  deal_id: string;
  task_text: string;
  assignee_role: string;
  status: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  deal_number: string | null;
  execution_status: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

type SortKey = "task_text" | "deal_number" | "customer_name" | "assignee_role" | "status" | "created_at";
type SortDirection = "asc" | "desc";

const STATUS_LABELS: Record<string, string> = {
  open: "לעשות",
  לעשות: "לעשות",
  pending: "ממתינה",
  in_progress: "בטיפול",
  completed: "הושלמה",
  cancelled: "בוטלה",
  פתוחה: "פתוחה",
  "ממתינה לתיאום": "ממתינה לתיאום",
  בטיפול: "בטיפול",
  הושלמה: "הושלמה",
  בוטלה: "בוטלה",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "success" | "warning" | "info"> = {
  open: "info",
  לעשות: "info",
  pending: "secondary",
  in_progress: "warning",
  completed: "success",
  cancelled: "destructive",
  פתוחה: "info",
  "ממתינה לתיאום": "secondary",
  בטיפול: "warning",
  הושלמה: "success",
  בוטלה: "destructive",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusLabel(status: string | null) {
  if (!status) return "ללא סטטוס";
  return STATUS_LABELS[status] ?? status;
}

function statusVariant(status: string | null) {
  return STATUS_VARIANTS[status ?? ""] ?? "secondary";
}

function compareTasks(a: CoordinationTask, b: CoordinationTask, key: SortKey) {
  if (key === "created_at") {
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  }

  const left = String(a[key] ?? "").toLocaleLowerCase("he");
  const right = String(b[key] ?? "").toLocaleLowerCase("he");
  return left.localeCompare(right, "he");
}

function SortButton({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      {active ? (
        direction === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
      ) : (
        <ArrowUpDown className="w-3.5 h-3.5 opacity-50" />
      )}
    </button>
  );
}

export default function Tasks() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTask, setSelectedTask] = useState<CoordinationTask | null>(null);

  const { data: tasks = [], isLoading, isError } = useQuery<CoordinationTask[]>({
    queryKey: ["coordination-tasks"],
    queryFn: () => apiFetch("/api/coordination-tasks"),
    staleTime: 30_000,
  });

  const assignees = useMemo(
    () => [...new Set(tasks.map((task) => task.assignee_role).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")),
    [tasks],
  );

  const statuses = useMemo(
    () => [...new Set(tasks.map((task) => task.status).filter((value): value is string => Boolean(value)))],
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("he");
    return tasks
      .filter((task) => {
        const matchesSearch = !normalizedSearch
          || [task.task_text, task.deal_number, task.customer_name, task.assignee_role]
            .some((value) => String(value ?? "").toLocaleLowerCase("he").includes(normalizedSearch));
        const matchesStatus = !statusFilter || task.status === statusFilter;
        const matchesAssignee = !assigneeFilter || task.assignee_role === assigneeFilter;
        return matchesSearch && matchesStatus && matchesAssignee;
      })
      .sort((a, b) => {
        const result = compareTasks(a, b, sortKey);
        return sortDirection === "asc" ? result : -result;
      });
  }, [assigneeFilter, search, sortDirection, sortKey, statusFilter, tasks]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "created_at" ? "desc" : "asc");
  }

  return (
    <Shell title="משימות">
      <div className="h-full overflow-y-auto px-8 py-6" dir="rtl">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-foreground">משימות לתיאום</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {visibleTasks.length.toLocaleString("he-IL")} מתוך {tasks.length.toLocaleString("he-IL")} משימות
              </p>
            </div>
            <ClipboardList className="w-8 h-8 text-primary" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="חיפוש לפי משימה, עסקה, לקוח או אחראי..."
                className="pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="נקה חיפוש"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              aria-label="סינון לפי סטטוס"
            >
              <option value="">כל הסטטוסים</option>
              {statuses.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={(event) => setAssigneeFilter(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              aria-label="סינון לפי אחראי"
            >
              <option value="">כל האחראים</option>
              {assignees.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
            </select>

            {(search || statusFilter || assigneeFilter) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("");
                  setAssigneeFilter("");
                }}
              >
                נקה סינונים
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-center py-16 text-sm text-destructive">
                שגיאה בטעינת המשימות
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <ClipboardList className="w-10 h-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {tasks.length === 0 ? "טרם נוצרו משימות לתיאום" : "לא נמצאו משימות לפי הסינון הנוכחי"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/50">
                      <th className="text-right px-4 py-3"><SortButton label="משימה" sortKey="task_text" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3"><SortButton label="עסקה" sortKey="deal_number" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3"><SortButton label="לקוח" sortKey="customer_name" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3"><SortButton label="אחראי" sortKey="assignee_role" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3"><SortButton label="סטטוס" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3"><SortButton label="נוצרה" sortKey="created_at" activeKey={sortKey} direction={sortDirection} onSort={handleSort} /></th>
                      <th className="text-right px-4 py-3">פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task, index) => (
                      <tr key={task.id} className={`border-b border-border/30 hover:bg-muted/50 transition-colors ${index % 2 ? "bg-muted/20" : ""}`}>
                        <td className="px-4 py-3 max-w-[360px]">
                          <div className="font-medium text-foreground line-clamp-2">{task.task_text}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {task.deal_id ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/deals/${task.deal_id}`)}
                              className="inline-flex items-center gap-1 font-mono text-primary hover:underline underline-offset-4"
                              title={`פתיחת עסקה ${task.deal_number ?? ""}`}
                            >
                              {task.deal_number ?? "עסקה"}
                              <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                            </button>
                          ) : (
                            <span className="font-mono text-foreground/80">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-foreground/70 whitespace-nowrap">{task.customer_name ?? "—"}</td>
                        <td className="px-4 py-3 text-foreground/70 whitespace-nowrap">{task.assignee_role || "—"}</td>
                        <td className="px-4 py-3">
                          <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">{formatDate(task.created_at)}</td>
                        <td className="px-4 py-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5"
                            onClick={() => setSelectedTask(task)}
                          >
                            <Eye className="w-4 h-4" />
                            צפייה
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent dir="rtl">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle>פרטי משימה</DialogTitle>
                <DialogDescription>משימת תיאום שנוצרה מתוך עסקה</DialogDescription>
              </DialogHeader>
              <div className="space-y-5 text-sm">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="text-xs text-muted-foreground mb-2">תיאור המשימה</div>
                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">{selectedTask.task_text}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">אחראי</div>
                    <div className="font-medium">{selectedTask.assignee_role || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">סטטוס</div>
                    <Badge variant={statusVariant(selectedTask.status)}>{statusLabel(selectedTask.status)}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">מספר עסקה</div>
                    {selectedTask.deal_id ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/deals/${selectedTask.deal_id}`)}
                        className="inline-flex items-center gap-1 font-mono text-primary hover:underline underline-offset-4"
                      >
                        {selectedTask.deal_number ?? "עסקה"}
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    ) : (
                      <div className="font-mono">—</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">לקוח</div>
                    <div>{selectedTask.customer_name ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">נוצרה בתאריך</div>
                    <div>{formatDate(selectedTask.created_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">עדכון אחרון</div>
                    <div>{formatDate(selectedTask.updated_at)}</div>
                  </div>
                </div>
                {selectedTask.deal_id && (
                  <div className="flex justify-start">
                    <Button type="button" variant="outline" onClick={() => navigate(`/deals/${selectedTask.deal_id}`)}>
                      <Eye className="w-4 h-4 ml-2" />
                      צפייה בעסקה
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
