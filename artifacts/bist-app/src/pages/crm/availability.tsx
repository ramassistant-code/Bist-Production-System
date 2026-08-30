import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getListCrmAvailabilityQueryKey,
  useListCrmAvailability,
  useUpdateCrmAvailability,
} from "@workspace/api-client-react";
import { CalendarCheck, CheckCircle2, Clock3, Loader2, Users } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useCrmView } from "./use-crm-view";
import { crmDate, crmEmpty, errorText } from "./format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CrmDataTable, type CrmTableColumn } from "./crm-data-table";

const ROLE_LABELS: Record<string, string> = {
  sales: "איש מכירות",
  sales_manager: "מנהל מכירות",
  admin: "מנהל מערכת",
};

const AVAILABILITY_COLUMNS: CrmTableColumn[] = [
  { key: "user", label: "משתמש", width: "27%" },
  { key: "role", label: "תפקיד", width: "14%" },
  { key: "availability", label: "זמין היום", width: "22%" },
  { key: "leads", label: "לידים היום", width: "11%" },
  { key: "queue", label: "מיקום בתור", width: "11%" },
  { key: "last", label: "הקצאה אחרונה", width: "15%" },
];

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "משתמש CRM";
}

export default function CrmAvailability() {
  const { appUser } = useAuth();
  const { isManager } = useCrmView();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [savingUserIds, setSavingUserIds] = useState<Set<string>>(() => new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

  const availabilityQuery = useListCrmAvailability({
    query: {
      enabled: isManager,
      queryKey: getListCrmAvailabilityQueryKey(),
    },
  });
  const updateMutation = useUpdateCrmAvailability({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: getListCrmAvailabilityQueryKey(),
        });
        toast({ title: "הזמינות עודכנה בהצלחה" });
      },
      onError: (error) => setUpdateError(errorText(error)),
    },
  });

  const rows = availabilityQuery.data ?? [];
  const availableCount = useMemo(
    () => rows.filter((row) => row.is_active && row.is_active_today).length,
    [rows],
  );
  const canSeeData = isManager;

  if (!canSeeData) {
    return (
      <Shell title="זמינות">
        <div
          className="mx-auto flex min-h-64 max-w-xl flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center"
          data-testid="status-crm-availability-forbidden"
        >
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-bold">אין לך הרשאה לעמוד זה</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            המסך הזה זמין למנהלי מכירות ולמנהלי מערכת בלבד.
          </p>
          <Button className="mt-6" asChild>
            <Link href="/crm/leads">חזרה ללידים</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="זמינות אנשי המכירות">
      <div className="mx-auto max-w-6xl space-y-6" dir="rtl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              ניהול הזמינות היומית וסדר חלוקת הלידים
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <CalendarCheck className="h-5 w-5 text-primary" />
            <span className="text-sm text-muted-foreground">זמינים היום</span>
            <strong className="text-lg">{availableCount}</strong>
          </div>
        </div>

        {availableCount === 0 && !availabilityQuery.isLoading && (
          <div
            className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
            role="alert"
            data-testid="status-crm-availability-none"
          >
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">אין כרגע איש מכירות זמין</p>
              <p className="mt-1 text-sm opacity-80">
                לידים חדשים יועברו למנהל המכירות עד שמשתמש פעיל יסומן כזמין.
              </p>
            </div>
          </div>
        )}

        {availabilityQuery.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : availabilityQuery.isError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive"
            role="alert"
            data-testid="status-crm-availability-error"
          >
            {errorText(availabilityQuery.error)}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-bold">
                <Users className="h-5 w-5 text-primary" />
                משתמשי CRM
            </h2>
            <CrmDataTable columns={AVAILABILITY_COLUMNS} testId="table-crm-availability">
                    {rows.map((row) => {
                      const isSelf = row.id === appUser?.id;
                      const isDisabled = !row.is_active || isSelf;
                      const isSaving = savingUserIds.has(row.id);
                      return (
                        <tr
                          key={row.id}
                          className={`${!row.is_active ? "bg-muted/30 text-muted-foreground" : ""} ${row.is_next_in_queue ? "bg-primary/5" : ""}`}
                          data-testid={`row-crm-availability-${row.id}`}
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div>
                                <p className="font-semibold">{crmEmpty(row.full_name || row.email)}</p>
                                {row.full_name && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">{row.email}</p>
                                )}
                              </div>
                              {row.is_next_in_queue && (
                                <Badge variant="success" className="whitespace-nowrap">
                                  הבא בתור
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-4">{roleLabel(row.role)}</td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={row.is_active_today}
                                disabled={isDisabled || isSaving}
                                onCheckedChange={(checked) => {
                                  setUpdateError(null);
                                  setSavingUserIds((current) => new Set(current).add(row.id));
                                  updateMutation.mutate(
                                    {
                                      userId: row.id,
                                      data: { is_active_today: checked },
                                    },
                                    {
                                      onSettled: () =>
                                        setSavingUserIds((current) => {
                                          const next = new Set(current);
                                          next.delete(row.id);
                                          return next;
                                        }),
                                    },
                                  );
                                }}
                                aria-label={`זמינות ${row.full_name || row.email}`}
                                title={
                                  isSelf
                                    ? "לא ניתן לשנות את הזמינות של עצמך"
                                    : !row.is_active
                                      ? "לא פעיל במערכת"
                                      : "שינוי הזמינות להיום"
                                }
                                data-testid={`switch-crm-availability-${row.id}`}
                              />
                              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                              <span className="text-xs text-muted-foreground">
                                {row.is_active_today ? "פעיל היום" : "לא זמין"}
                              </span>
                            </div>
                            {isSelf && (
                              <p className="mt-1 text-xs text-muted-foreground">לא ניתן לשנות את עצמך</p>
                            )}
                            {!isSelf && !row.is_active && (
                              <p className="mt-1 text-xs text-muted-foreground">לא פעיל במערכת</p>
                            )}
                          </td>
                          <td className="px-4 py-4 font-medium">{row.leads_today}</td>
                          <td className="px-4 py-4">{row.queue_position > 0 ? row.queue_position : "—"}</td>
                          <td className="px-4 py-4 text-muted-foreground">
                            {crmDate(row.last_assigned_at)}
                          </td>
                        </tr>
                      );
                    })}
            </CrmDataTable>
              {updateError && (
                <p className="rounded-lg border border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive" role="alert">
                  {updateError}
                </p>
              )}
              {savingUserIds.size > 0 && (
                <div className="sr-only" aria-live="polite">שומר את הזמינות</div>
              )}
          </div>
        )}
      </div>
    </Shell>
  );
}