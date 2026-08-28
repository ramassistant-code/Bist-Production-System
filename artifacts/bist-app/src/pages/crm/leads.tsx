import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import { Shell } from "@/components/layout/shell";
import {
  getListCrmFunnelsQueryKey,
  getListCrmLeadStatusesQueryKey,
  getListCrmLeadsQueryKey,
  useListCrmFunnels,
  useListCrmLeadStatuses,
  useListCrmLeads,
} from "@workspace/api-client-react";
import { useCrmView } from "./use-crm-view";
import { useActiveSalesUsers } from "./use-users";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Users, SwitchCamera } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CrmDataTable, type CrmTableColumn } from "./crm-data-table";
import { crmDate, crmEmpty } from "./format";

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
  
  const statusParam = searchParams.get("status") || "new";
  const searchParam = searchParams.get("search") || "";
  const funnelParam = searchParams.get("funnel") || "all";
  const repParam = searchParams.get("rep") || "all";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);
  const [searchInput, setSearchInput] = useState(searchParam);

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
  } = useListCrmLeadStatuses({ view }, {
    query: {
      queryKey: getListCrmLeadStatusesQueryKey({ view }),
    },
  });

  const {
    data: leads,
    isLoading: isLoadingLeads,
    isError: isLeadsError,
  } = useListCrmLeads({ view, status: statusParam, search: searchParam || undefined, funnel: funnelParam !== 'all' ? funnelParam : undefined, sales_rep: repParam !== 'all' ? repParam : undefined, limit, offset }, {
    query: {
      queryKey: getListCrmLeadsQueryKey({ view, status: statusParam, search: searchParam || undefined, funnel: funnelParam !== 'all' ? funnelParam : undefined, sales_rep: repParam !== 'all' ? repParam : undefined, limit, offset }),
      placeholderData: (prev) => prev,
    },
  });

  const { data: funnels } = useListCrmFunnels({
    query: {
      queryKey: getListCrmFunnelsQueryKey(),
    }
  });

  const { data: reps } = useActiveSalesUsers();

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateParams({ search: searchInput.trim() });
  };

  const sortedStatuses = useMemo(() => {
    if (!statuses) return [];
    return [...statuses].sort((a, b) => a.sort_order - b.sort_order);
  }, [statuses]);

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
                    {reps?.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.full_name || r.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {isManager && (
              <Button
                variant={view === "manager" ? "default" : "secondary"}
                onClick={() => setView(view === "manager" ? "rep" : "manager")}
                className="shrink-0"
                data-testid="button-toggle-view"
              >
                <SwitchCamera className="w-4 h-4" />
                {view === "manager" ? "מצב מנהל" : "מצב איש מכירות"}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto pb-1 -mb-1">
            <Tabs value={statusParam} onValueChange={(v) => updateParams({ status: v })}>
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
                    שגיאה בטעינת הסטטוסים
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
            </Tabs>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {isLoadingLeads ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : isLeadsError ? (
            <div
              className="flex h-48 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 text-sm text-destructive"
              data-testid="status-crm-leads-error"
            >
              שגיאה בטעינת הלידים
            </div>
          ) : leads?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center bg-card rounded-xl border border-border">
              <Users className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">לא נמצאו לידים</h3>
              <p className="text-sm text-muted-foreground mt-1">נסה לשנות את סינוני החיפוש או לבחור סטטוס אחר</p>
            </div>
          ) : (
            <CrmDataTable columns={LEAD_COLUMNS} testId="table-crm-leads">
                  {leads?.map(lead => {
                    const rep = reps?.find(r => r.id === lead.sales_rep_id);
                    return (
                      <tr 
                        key={lead.id} 
                        className="hover:bg-accent/50 transition-colors cursor-pointer group"
                        onClick={() => setLocation(`/crm/leads/${lead.id}`)}
                        data-testid={`row-lead-${lead.id}`}
                      >
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
                           <div className="truncate text-xs text-muted-foreground">{crmEmpty(lead.source)}</div>
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
              disabled={pageParam <= 1 || isLoadingLeads}
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
              disabled={!leads || leads.length < limit || isLoadingLeads}
               data-testid="button-crm-leads-next"
            >
              הבא
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
