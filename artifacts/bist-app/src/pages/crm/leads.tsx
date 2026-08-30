import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import {
  getListCrmAvailabilityQueryKey,
  getListCrmFunnelsQueryKey,
  getListCrmLeadStatusesQueryKey,
  getListCrmLeadsQueryKey,
  listCrmLeads,
  useBulkAssignCrmLeads,
  useListCrmFunnels,
  useListCrmAvailability,
  useListCrmLeadStatuses,
  useListCrmLeads,
} from "@workspace/api-client-react";
import { useCrmView } from "./use-crm-view";
import { useActiveSalesUsers, useSalesUsers } from "./use-users";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Loader2, Users, UserRoundPlus, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmDataTable, type CrmTableColumn } from "./crm-data-table";
import { crmDate, crmEmpty, errorText } from "./format";
import { useToast } from "@/hooks/use-toast";

const LEAD_COLUMNS: CrmTableColumn[] = [
  { key: "name", label: "שם הליד", width: "22%" },
  { key: "phone", label: "טלפון", width: "14%" },
  { key: "funnel", label: "משפך / מקור", width: "19%" },
  { key: "capture", label: "ניסיונות תפיסה", width: "13%" },
  { key: "rep", label: "נציג.ה", width: "16%" },
  { key: "inquiry", label: "פנייה אחרונה", width: "16%" },
];

export default function CrmLeads() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  
  const { view, setView, isManager } = useCrmView();
  
  const pendingPool = searchParams.get("pool") === "pending";
  const statusParam = pendingPool ? "" : searchParams.get("status") || "new";
  const searchParam = searchParams.get("search") || "";
  const funnelParam = pendingPool ? "all" : searchParams.get("funnel") || "all";
  const repParam = pendingPool ? "all" : searchParams.get("rep") || "all";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);
  const [searchInput, setSearchInput] = useState(searchParam);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => setSearchInput(searchParam), [searchParam]);
  
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchString);
    let resetPage = false;
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'page') resetPage = true;
      if (value === null || value === "" || value === "all") {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }
    if (resetPage) newParams.set("page", "1");
    setLocation(`/crm/leads?${newParams.toString()}`);
  }, [searchString, setLocation]);

  const limit = 50;
  const offset = (pageParam - 1) * limit;

  const {
    data: statuses,
    isLoading: isLoadingStatuses,
    isError: isStatusesError,
    error: statusesError,
  } = useListCrmLeadStatuses({ view }, {
    query: {
      queryKey: getListCrmLeadStatusesQueryKey({ view }),
    },
  });

  const {
    data: leads,
    isLoading: isLoadingLeads,
    isError: isLeadsError,
    error: leadsError,
  } = useListCrmLeads({ view, status: statusParam || undefined, search: searchParam || undefined, funnel: funnelParam !== 'all' ? funnelParam : undefined, sales_rep: repParam !== 'all' ? repParam : undefined, limit, offset }, {
    query: {
      enabled: !pendingPool,
      queryKey: getListCrmLeadsQueryKey({ view, status: statusParam || undefined, search: searchParam || undefined, funnel: funnelParam !== 'all' ? funnelParam : undefined, sales_rep: repParam !== 'all' ? repParam : undefined, limit, offset }),
      placeholderData: (prev) => prev,
    },
  });

  const { data: availability } = useListCrmAvailability({
    query: {
      enabled: isManager,
      queryKey: getListCrmAvailabilityQueryKey(),
    },
  });

  const pendingPoolQuery = useQuery({
    enabled: isManager,
    // מפתח נפרד ולא getListCrmLeadsQueryKey({...}) עם אותם פרמטרים: מה שנשמר
    // כאן הוא תת-קבוצה מסוננת ולא תשובת הרשימה. אותו מפתח לשניהם היה מגיש
    // את הסינון הזה לכל קריאה עתידית עם אותם ארגומנטים. נשאר תחת התחילית
    // של הלידים כדי שביטול ה-cache הקיים ימשיך לרענן אותו.
    queryKey: [...getListCrmLeadsQueryKey(), "pending-reassignment"],
    queryFn: async ({ signal }) => {
      const pending = [];
      let batchOffset = 0;
      while (true) {
        const batch = await listCrmLeads(
          { view: "manager", limit: 500, offset: batchOffset },
          { signal },
        );
        pending.push(...batch.filter((lead) => lead.pending_reassignment));
        if (batch.length < 500) return pending;
        batchOffset += 500;
      }
    },
    staleTime: 60_000,
  });

  const { data: funnels } = useListCrmFunnels({
    query: {
      queryKey: getListCrmFunnelsQueryKey(),
    }
  });

  const { data: reps } = useSalesUsers();
  const { data: activeReps } = useActiveSalesUsers();

  const visibleLeads = useMemo(
    () =>
      pendingPool
        ? (pendingPoolQuery.data ?? []).slice(offset, offset + limit)
        : leads ?? [],
    [leads, offset, pendingPool, pendingPoolQuery.data],
  );
  const pendingCount = pendingPoolQuery.data?.length ?? 0;
  const effectiveLeadsLoading = pendingPool
    ? pendingPoolQuery.isLoading
    : isLoadingLeads;
  const effectiveLeadsError = pendingPool
    ? pendingPoolQuery.isError
    : isLeadsError;
  const effectiveLeadsErrorValue = pendingPool
    ? pendingPoolQuery.error
    : leadsError;
  const activeAvailabilityUsers = useMemo(
    () => availability?.filter((user) => user.is_active) ?? [],
    [availability],
  );
  const targetUser = activeAvailabilityUsers.find((user) => user.id === targetUserId);
  const currentLeadIds = useMemo(() => visibleLeads.map((lead) => lead.id), [visibleLeads]);
  const selectedCount = selectedLeadIds.length;
  const allVisibleSelected =
    currentLeadIds.length > 0 && currentLeadIds.every((id) => selectedLeadIds.includes(id));
  const displayColumns: CrmTableColumn[] = isManager
    ? [
        {
          key: "select",
          label: (
            <div className="flex flex-col items-center gap-1">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) => toggleVisibleLeads(checked === true)}
                aria-label="בחירת כל הלידים המוצגים"
                data-testid="checkbox-leads-select-visible"
              />
              <span className="whitespace-nowrap text-[10px]">
                בחר הכל בדף ({selectedCount}/{currentLeadIds.length})
              </span>
            </div>
          ),
          width: "8%",
          className: "text-center",
        },
        ...LEAD_COLUMNS,
      ]
    : LEAD_COLUMNS;

  useEffect(() => {
    setSelectedLeadIds([]);
    setTargetUserId("");
    setTransferDialogOpen(false);
    setBulkError(null);
  }, [pageParam, pendingPool, searchParam, statusParam, funnelParam, repParam]);

  const bulkAssignMutation = useBulkAssignCrmLeads({
    mutation: {
      onSuccess: async (result) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListCrmLeadsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListCrmLeadStatusesQueryKey() }),
        ]);
        setSelectedLeadIds([]);
        setTargetUserId("");
        setTransferDialogOpen(false);
        setBulkError(null);
        toast({
          title: "הלידים הוקצו בהצלחה",
          description: `${result.updated_count} לידים הוקצו ל${targetUser?.full_name || targetUser?.email || "נציג היעד"}`,
        });
      },
      onError: (error) => setBulkError(errorText(error)),
    },
  });

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateParams({ search: searchInput.trim() });
  };

  const sortedStatuses = useMemo(() => {
    if (!statuses) return [];
    return [...statuses].sort((a, b) => a.sort_order - b.sort_order);
  }, [statuses]);

  const toggleLead = (leadId: string, checked: boolean) => {
    setSelectedLeadIds((current) =>
      checked
        ? current.includes(leadId) ? current : [...current, leadId]
        : current.filter((id) => id !== leadId),
    );
  };

  const toggleVisibleLeads = (checked: boolean) => {
    setSelectedLeadIds(checked ? currentLeadIds : []);
  };

  const openTransferDialog = () => {
    if (selectedCount === 0 || selectedCount > 500 || !targetUserId) return;
    setBulkError(null);
    setTransferDialogOpen(true);
  };

  const submitBulkAssignment = () => {
    if (selectedCount === 0 || selectedCount > 500 || !targetUserId) return;
    bulkAssignMutation.mutate({
      data: {
        lead_ids: selectedLeadIds,
        target_user_id: targetUserId,
      },
    });
  };

  return (
    <Shell title="CRM לידים" noPadding>
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border bg-card p-4 space-y-4 shrink-0">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-4 flex-wrap">
              <form onSubmit={handleSearch} className="relative w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  name="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="חיפוש לפי שם, טלפון, דוא״ל..."
                  className="pr-9"
                  data-testid="input-search-leads"
                />
              </form>
              
              <Select value={funnelParam} onValueChange={(v) => updateParams({ funnel: v })}>
                <SelectTrigger className="w-48" data-testid="select-funnel">
                  <SelectValue placeholder="כל המשפכים" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all">כל המשפכים</SelectItem>
                  {funnels?.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isManager && (
                <Select value={repParam} onValueChange={(v) => updateParams({ rep: v })}>
                  <SelectTrigger className="w-48" data-testid="select-rep">
                    <SelectValue placeholder="כל נציגי המכירות" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">כל נציגי המכירות</SelectItem>
                    {activeReps?.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.full_name || r.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {isManager && (
                <Button
                  type="button"
                  variant={pendingPool ? "default" : "outline"}
                  className="gap-2"
                  onClick={() => {
                    setView("manager");
                    updateParams({ pool: pendingPool ? null : "pending", status: null, funnel: null, rep: null, search: null });
                  }}
                  data-testid="button-crm-pending-pool"
                >
                  <UserRoundPlus className="h-4 w-4" />
                  ממתין להשמה
                  <Badge variant={pendingPool ? "secondary" : "warning"}>{pendingCount}</Badge>
                </Button>
              )}
            </div>

            {isManager && (
              // פקד דו-מצבי ולא כפתור החלפה: כפתור יחיד שכתוב עליו "מצב מנהל"
              // נקרא כפעולה ("עבור למצב מנהל") ולא כמצב הנוכחי. כאן שתי
              // האפשרויות גלויות והפעילה מסומנת, אז אין מה לפרש.
              <div
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
                role="group"
                aria-label="מצב תצוגה"
                data-testid="toggle-crm-view"
              >
                <Button
                  size="sm"
                  variant={view === "rep" ? "default" : "ghost"}
                  aria-pressed={view === "rep"}
                  onClick={() => setView("rep")}
                  data-testid="button-view-rep"
                >
                  מצב איש מכירות
                </Button>
                <Button
                  size="sm"
                  variant={view === "manager" ? "default" : "ghost"}
                  aria-pressed={view === "manager"}
                  onClick={() => setView("manager")}
                  data-testid="button-view-manager"
                >
                  מצב מנהל
                </Button>
              </div>
            )}
          </div>

          {pendingPool && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <div>
                <p className="font-semibold">לידים שממתינים להשמה</p>
                <p className="text-sm text-muted-foreground">
                  מוצגים {visibleLeads.length} מתוך {pendingCount} לידים. ניתן לבחור רק לידים שמוצגים בעמוד זה.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => updateParams({ pool: null })}>
                <X className="ml-2 h-4 w-4" />
                חזרה לכל הלידים
              </Button>
            </div>
          )}

          {isManager && selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3" data-testid="crm-bulk-action-bar">
              <Badge variant="secondary" className="text-sm">
                {selectedCount} לידים נבחרו
              </Badge>
              <Select value={targetUserId} onValueChange={setTargetUserId}>
                <SelectTrigger className="w-56" data-testid="select-crm-bulk-target">
                  <SelectValue placeholder="בחר נציג יעד" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {activeAvailabilityUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                onClick={openTransferDialog}
                disabled={!targetUserId || selectedCount > 500 || bulkAssignMutation.isPending}
                data-testid="button-crm-bulk-assign"
              >
                {bulkAssignMutation.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
                הקצה לידים
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedLeadIds([])}>
                ביטול בחירה
              </Button>
              {selectedCount > 500 && (
                <p className="basis-full text-sm text-destructive">
                  ניתן להעביר עד 500 לידים בכל פעולה. צמצם את הבחירה לפני ההעברה.
                </p>
              )}
              {activeAvailabilityUsers.length === 0 && (
                <p className="basis-full text-sm text-muted-foreground">
                  אין משתמש פעיל שניתן לבחור כיעד.
                </p>
              )}
              {bulkError && (
                <p className="basis-full text-sm text-destructive" role="alert">
                  {bulkError}
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto pb-1 -mb-1">
            {!pendingPool && <Tabs value={statusParam} onValueChange={(v) => updateParams({ status: v })}>
              <TabsList className="bg-transparent p-0 justify-start gap-2 h-auto" data-testid="tabs-statuses">
                {isLoadingStatuses ? (
                  <div className="flex items-center gap-2 p-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">טוען סטטוסים...</span>
                  </div>
                ) : isStatusesError ? (
                  <p
                    className="px-2 py-1 text-sm text-destructive"
                    data-testid="status-crm-statuses-error"
                  >
                     {errorText(statusesError)}
                  </p>
                ) : (
                  sortedStatuses.map((s) => (
                    <TabsTrigger
                      key={s.code}
                      value={s.code}
                      data-testid={`tab-status-${s.code}`}
                      className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground border border-transparent data-[state=inactive]:border-border bg-card rounded-full px-4 py-1.5 shadow-sm text-sm"
                    >
                      {s.label}
                       <span
                         className="ml-2 mr-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-xs opacity-70 dark:bg-white/20"
                         data-testid={`count-status-${s.code}`}
                       >
                        {s.lead_count}
                      </span>
                    </TabsTrigger>
                  ))
                )}
              </TabsList>
            </Tabs>}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {effectiveLeadsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : effectiveLeadsError ? (
            <div
              className="flex h-48 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-destructive"
              data-testid="status-crm-leads-error"
            >
              {errorText(effectiveLeadsErrorValue)}
            </div>
          ) : visibleLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center bg-card rounded-xl border border-border">
              <Users className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">
                {pendingPool ? "אין לידים שממתינים להשמה" : "לא נמצאו לידים"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {pendingPool
                  ? "כל הלידים משויכים כרגע לנציגים."
                  : "נסה לשנות את סינוני החיפוש או לבחור סטטוס אחר"}
              </p>
            </div>
          ) : (
            <CrmDataTable columns={displayColumns} testId="table-crm-leads">
                  {visibleLeads.map(lead => {
                    const rep = reps?.find(r => r.id === lead.sales_rep_id);
                    return (
                      <tr 
                        key={lead.id} 
                        className="hover:bg-accent/50 transition-colors cursor-pointer group"
                        onClick={() => setLocation(`/crm/leads/${lead.id}`)}
                        data-testid={`row-lead-${lead.id}`}
                      >
                        {isManager && (
                          <td className="px-3 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                              checked={selectedLeadIds.includes(lead.id)}
                              onCheckedChange={(checked) => toggleLead(lead.id, checked === true)}
                              aria-label={`בחירת ליד ${lead.name}`}
                              data-testid={`checkbox-lead-${lead.id}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3">
                           <div
                             className="truncate font-semibold text-foreground"
                             data-testid={`text-lead-name-${lead.id}`}
                           >
                             {lead.name}
                           </div>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {lead.is_active_customer && (
                              <Badge variant="success" className="text-[10px] px-1.5 py-0">לקוח פעיל</Badge>
                            )}
                            {lead.inquiry_count > 1 && (
                              <Badge variant="warning" className="text-[10px] px-1.5 py-0">השאיר פרטים שוב</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3" dir="ltr" style={{ textAlign: "right" }}>
                           {crmEmpty(lead.phone_e164 || lead.phone_raw)}
                        </td>
                        <td className="px-4 py-3">
                           <div className="truncate font-medium">{crmEmpty(lead.funnel_name)}</div>
                        </td>
                         <td className="px-4 py-3 text-center">
                          {lead.capture_attempts > 0 ? (
                            <Badge variant="outline" className="text-[10px]">
                               {lead.capture_attempts}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                         <td className="truncate px-4 py-3">
                           {rep?.full_name || rep?.email || "לא הוקצה"}
                         </td>
                         <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                           {crmDate(lead.last_inquiry_at, true)}
                         </td>
                      </tr>
                    );
                  })}
            </CrmDataTable>
          )}

          <div className="flex items-center justify-between mt-6 px-2">
            <Button 
              variant="outline" 
              onClick={() => updateParams({ page: Math.max(1, pageParam - 1).toString() })}
              disabled={pageParam <= 1 || effectiveLeadsLoading}
               data-testid="button-crm-leads-previous"
            >
              הקודם
            </Button>
            <span className="text-sm text-muted-foreground">
              עמוד {pageParam}
            </span>
            <Button 
              variant="outline" 
              onClick={() => updateParams({ page: (pageParam + 1).toString() })}
              disabled={
                effectiveLeadsLoading ||
                (pendingPool
                  ? offset + limit >= pendingCount
                  : !leads || leads.length < limit)
              }
               data-testid="button-crm-leads-next"
            >
              הבא
            </Button>
          </div>
        </div>
        <AlertDialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>אישור הקצאת לידים</AlertDialogTitle>
              <AlertDialogDescription>
                האם להקצות {selectedCount} לידים ל{targetUser?.full_name || targetUser?.email || "נציג היעד"}?
                פעולה זו תעביר גם את המשימות הפתוחות של הלידים לנציג היעד.
              </AlertDialogDescription>
              {bulkError && (
                <p className="text-sm text-destructive" role="alert">
                  {bulkError}
                </p>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel disabled={bulkAssignMutation.isPending}>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  submitBulkAssignment();
                }}
                disabled={bulkAssignMutation.isPending}
                data-testid="button-crm-bulk-confirm"
              >
                {bulkAssignMutation.isPending ? "מקצה..." : "אישור והקצאה"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Shell>
  );
}
