import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListMyCrmTasksQueryKey,
  useListMyCrmTasks,
  useUpdateCrmLeadTask,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { crmDate } from "@/pages/crm/format";

export function TaskNudgeProvider() {
  const queryClient = useQueryClient();
  const [visibleTaskId, setVisibleTaskId] = useState<string | null>(null);
  const tasksQuery = useListMyCrmTasks({
    query: {
      queryKey: getListMyCrmTasksQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const updateTask = useUpdateCrmLeadTask();
  const tasks = tasksQuery.data ?? [];
  const activeTask = tasks.find((task) => task.id === visibleTaskId) ?? tasks[0];

  useEffect(() => {
    if (!activeTask) {
      setVisibleTaskId(null);
    } else if (!visibleTaskId || !tasks.some((task) => task.id === visibleTaskId)) {
      setVisibleTaskId(activeTask.id);
    }
  }, [activeTask, tasks, visibleTaskId]);

  if (tasksQuery.isLoading || tasksQuery.isError || !activeTask) return null;

  const update = (data: { status?: "open" | "done"; snoozed_until?: string }) => {
    updateTask.mutate(
      { id: activeTask.id, data },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: getListMyCrmTasksQueryKey() });
          setVisibleTaskId(null);
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => event.preventDefault()}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card p-6 text-right shadow-2xl"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-task-nudge-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.preventDefault();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs font-medium text-primary">תזכורת משימה</p>
        <h2 id="crm-task-nudge-title" className="mt-2 text-xl font-bold">{activeTask.title}</h2>
        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p>ליד: {activeTask.lead_name}</p>
          <p dir="ltr" className="text-right">{activeTask.lead_phone}</p>
          <p>תאריך יעד: {crmDate(activeTask.due_at, true)}</p>
        </div>
        <Link href={`/crm/leads/${activeTask.lead_id}`} className="mt-4 inline-block text-sm text-primary hover:underline">
          מעבר לכרטיס הליד
        </Link>
        <div className="mt-6 flex gap-2">
          <Button className="flex-1" disabled={updateTask.isPending} onClick={() => update({ status: "done" })}>בוצע</Button>
          <Button className="flex-1" variant="outline" disabled={updateTask.isPending} onClick={() => update({ snoozed_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() })}>דחה</Button>
        </div>
        {updateTask.isError && <p className="mt-3 text-sm text-destructive">שגיאה בעדכון המשימה. נסה שוב.</p>}
      </div>
    </div>
  );
}