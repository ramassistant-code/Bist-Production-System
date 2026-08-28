import { useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import {
  getListCrmFunnelCostHistoryQueryKey,
  getListCrmFunnelsQueryKey,
  useCreateCrmFunnel,
  useListCrmFunnelCostHistory,
  useListCrmFunnels,
  useUpdateCrmFunnel,
  type CrmFunnel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Edit, History, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { CrmDataTable, type CrmTableColumn } from "./crm-data-table";
import { crmCurrency, crmDate } from "./format";

const FUNNEL_COLUMNS: CrmTableColumn[] = [
  { key: "name", label: "שם המשפך", width: "35%" },
  { key: "status", label: "סטטוס", width: "15%" },
  { key: "cost", label: "עלות לליד נוכחית", width: "25%" },
  { key: "actions", label: "פעולות", width: "25%", className: "text-center" },
];

const HISTORY_COLUMNS: CrmTableColumn[] = [
  { key: "from", label: "תאריך התחלה", width: "35%" },
  { key: "to", label: "תאריך סיום", width: "35%" },
  { key: "cost", label: "עלות", width: "30%" },
];

function FunnelDialog({ funnel, onOpenChange, open }: { funnel?: CrmFunnel, open: boolean, onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createFunnel = useCreateCrmFunnel();
  const updateFunnel = useUpdateCrmFunnel();

  const [name, setName] = useState(funnel?.name || "");
  const [cost, setCost] = useState(funnel?.current_cost_per_lead || "");
  const [isActive, setIsActive] = useState(funnel ? funnel.is_active : true);

  const isPending = createFunnel.isPending || updateFunnel.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name,
      current_cost_per_lead: cost || null,
      is_active: isActive
    };

    if (funnel) {
      updateFunnel.mutate({ data: { id: funnel.id, ...data } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrmFunnelsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListCrmFunnelCostHistoryQueryKey(funnel.id) });
          toast({ title: "נשמר בהצלחה" });
          onOpenChange(false);
        },
        onError: () => toast({ title: "שגיאה בשמירת המשפך", variant: "destructive" }),
      });
    } else {
      createFunnel.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCrmFunnelsQueryKey() });
          toast({ title: "נוצר בהצלחה" });
          onOpenChange(false);
        },
        onError: () => toast({ title: "שגיאה ביצירת המשפך", variant: "destructive" }),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>{funnel ? "עריכת משפך" : "משפך חדש"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>שם המשפך</Label>
            <Input required value={name} onChange={e => setName(e.target.value)} data-testid="input-funnel-name" />
          </div>
          <div className="space-y-2">
            <Label>עלות לליד נוכחית (₪)</Label>
            <Input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} data-testid="input-funnel-cost" />
          </div>
          <div className="flex items-center justify-between">
            <Label>פעיל</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} dir="ltr" data-testid="switch-funnel-active" />
          </div>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={isPending || !name.trim()} data-testid="button-save-funnel">
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              שמור
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CostHistoryDialog({ funnelId, open, onOpenChange }: { funnelId: string, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useListCrmFunnelCostHistory(funnelId, {
    query: {
      queryKey: getListCrmFunnelCostHistoryQueryKey(funnelId),
      enabled: open
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>היסטוריית עלויות</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : !data?.length ? (
            <p className="text-center text-muted-foreground py-8">אין היסטוריה.</p>
          ) : (
            <CrmDataTable columns={HISTORY_COLUMNS} testId="table-crm-funnel-history">
                {data.map(h => (
                  <tr key={h.id}>
                    <td className="p-2">{crmDate(h.valid_from, true)}</td>
                    <td className="p-2">{crmDate(h.valid_to, true)}</td>
                    <td className="p-2 font-medium">{crmCurrency(h.cost_per_lead)}</td>
                  </tr>
                ))}
            </CrmDataTable>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CrmFunnels() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";
  const { data: funnels, isLoading, isError } = useListCrmFunnels({ query: { queryKey: getListCrmFunnelsQueryKey(), enabled: isAdmin } });

  const [editFunnel, setEditFunnel] = useState<CrmFunnel | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [historyFunnel, setHistoryFunnel] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <Shell title="משפכים">
        <EmptyState title="אין הרשאה" description="רק מנהלי מערכת יכולים לגשת לעמוד זה." />
      </Shell>
    );
  }

  return (
    <Shell title="ניהול משפכים">
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
          <div>
            <h2 className="text-lg font-bold">משפכים</h2>
            <p className="text-sm text-muted-foreground">ניהול ערוצי שיווק ועלויות לליד</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-funnel">
            <Plus className="w-4 h-4 ml-2" />
            משפך חדש
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive" data-testid="status-crm-funnels-error">
            שגיאה בטעינת המשפכים
          </div>
        ) : (
          <CrmDataTable columns={FUNNEL_COLUMNS} testId="table-crm-funnels">
                {funnels?.map(f => (
                  <tr key={f.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-funnel-${f.id}`}>
                    <td className="px-6 py-4 font-semibold">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary opacity-70" />
                        {f.name}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {f.is_active ? <Badge variant="success">פעיל</Badge> : <Badge variant="secondary">לא פעיל</Badge>}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {crmCurrency(f.current_cost_per_lead)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setHistoryFunnel(f.id)} data-testid={`button-funnel-history-${f.id}`}>
                          <History className="w-4 h-4 ml-1" />
                          היסטוריה
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditFunnel(f)} data-testid={`button-edit-funnel-${f.id}`}>
                          <Edit className="w-4 h-4 ml-1" />
                          עריכה
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!funnels?.length && (
                  <tr>
                    <td colSpan={4} className="text-center p-8 text-muted-foreground">לא נמצאו משפכים.</td>
                  </tr>
                )}
          </CrmDataTable>
        )}
      </div>

      {createOpen && <FunnelDialog open={createOpen} onOpenChange={setCreateOpen} />}
      {editFunnel && <FunnelDialog funnel={editFunnel} open={!!editFunnel} onOpenChange={(o) => !o && setEditFunnel(null)} />}
      {historyFunnel && <CostHistoryDialog funnelId={historyFunnel} open={!!historyFunnel} onOpenChange={(o) => !o && setHistoryFunnel(null)} />}
    </Shell>
  );
}
