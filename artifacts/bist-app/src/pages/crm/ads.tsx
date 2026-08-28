import { useMemo, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import {
  getListCrmAdsQueryKey,
  getListCrmFunnelsQueryKey,
  getListUnlinkedCrmAdsQueryKey,
  useLinkCrmAd,
  useListCrmAds,
  useListCrmFunnels,
  useListUnlinkedCrmAds,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { CrmDataTable, type CrmTableColumn } from "./crm-data-table";
import { crmDate } from "./format";

const AD_COLUMNS: CrmTableColumn[] = [
  { key: "name", label: "שם המודעה", width: "31%" },
  { key: "sync", label: "סטטוס סנכרון", width: "20%" },
  { key: "funnel", label: "משפך מקושר", width: "29%" },
  { key: "actions", label: "פעולות", width: "20%" },
];

export default function CrmAds() {
  const { appUser } = useAuth();
  const isAdmin = appUser?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [filterMode, setFilterMode] = useState("all");

  const { data: ads, isLoading: isLoadingAds, isError } = useListCrmAds({
    query: { queryKey: getListCrmAdsQueryKey(), enabled: isAdmin } 
  });
  const { data: unlinkedAds = [] } = useListUnlinkedCrmAds({
    query: {
      queryKey: getListUnlinkedCrmAdsQueryKey(),
      enabled: isAdmin,
    },
  });
  
  const { data: funnels } = useListCrmFunnels({ 
    query: { queryKey: getListCrmFunnelsQueryKey(), enabled: isAdmin } 
  });
  
  const linkAd = useLinkCrmAd();

  const unlinkedCount = unlinkedAds.length;
  
  const filteredAds = useMemo(() => {
    if (!ads) return [];
    if (filterMode === "unlinked") return unlinkedAds;
    if (filterMode === "linked") return ads.filter(a => a.funnel_id);
    return ads;
  }, [ads, filterMode, unlinkedAds]);

  const handleLink = (adId: string, funnelId: string | null) => {
    linkAd.mutate({ id: adId, data: { funnel_id: funnelId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrmAdsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUnlinkedCrmAdsQueryKey() });
        toast({ title: funnelId ? "מודעה קושרה בהצלחה" : "קישור מודעה הוסר" });
      },
      onError: () => toast({ title: "שגיאה בעדכון קישור המודעה", variant: "destructive" }),
    });
  };

  if (!isAdmin) {
    return (
      <Shell title="מודעות">
        <EmptyState title="אין הרשאה" description="רק מנהלי מערכת יכולים לגשת לעמוד זה." />
      </Shell>
    );
  }

  return (
    <Shell title="ניהול מודעות">
      <div className="flex flex-col gap-6 h-full pb-6">
        {unlinkedCount > 0 && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg flex flex-wrap gap-3 items-center justify-between shadow-sm shrink-0" data-testid="banner-unlinked-ads">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-semibold">ישנן {unlinkedCount} מודעות שאינן מקושרות לאף משפך!</span>
              <span className="text-sm">לידים שמגיעים ממודעות אלו לא יקבלו ייחוס עלות נכון.</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setFilterMode("unlinked")} className="bg-background" data-testid="button-show-unlinked-ads">
              הצג מודעות לא מקושרות
            </Button>
          </div>
        )}

        <div className="flex justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm shrink-0">
          <div>
            <h2 className="text-lg font-bold">מודעות פייסבוק</h2>
            <p className="text-sm text-muted-foreground">קישור מודעות פייסבוק למשפכים פנימיים</p>
          </div>
          
          <Tabs value={filterMode} onValueChange={setFilterMode}>
            <TabsList>
              <TabsTrigger value="all" data-testid="tab-ads-all">הכל ({ads?.length || 0})</TabsTrigger>
              <TabsTrigger value="linked" data-testid="tab-ads-linked">מקושרות ({(ads?.length || 0) - unlinkedCount})</TabsTrigger>
              <TabsTrigger value="unlinked" data-testid="tab-ads-unlinked">לא מקושרות ({unlinkedCount})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoadingAds ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive" data-testid="status-crm-ads-error">
            שגיאה בטעינת המודעות
          </div>
        ) : (
          <CrmDataTable columns={AD_COLUMNS} testId="table-crm-ads" className="flex-1">
                {filteredAds?.map(ad => (
                  <tr key={ad.id} className="hover:bg-muted/50 transition-colors" data-testid={`row-ad-${ad.id}`}>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-semibold">{ad.name || `מודעה ${ad.facebook_ad_id}`}</span>
                        <span className="text-xs text-muted-foreground font-mono mt-0.5">{ad.facebook_ad_id}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {ad.fetch_failed ? (
                        <Badge variant="destructive" className="text-[10px]">שגיאת סנכרון</Badge>
                      ) : ad.last_synced_at ? (
                         <span className="text-xs text-muted-foreground">סונכרן: {crmDate(ad.last_synced_at, true)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 min-w-[250px]">
                      <Select 
                        value={ad.funnel_id || "unlinked"} 
                        onValueChange={(val) => handleLink(ad.id, val === "unlinked" ? null : val)}
                      >
                         <SelectTrigger className={`w-full max-w-[220px] ${!ad.funnel_id ? 'border-warning/50 bg-warning/10 text-warning-foreground' : ''}`} data-testid={`select-ad-funnel-${ad.id}`}>
                          <SelectValue placeholder="בחר משפך..." />
                        </SelectTrigger>
                        <SelectContent dir="rtl">
                          <SelectItem value="unlinked">
                            <span className="text-muted-foreground italic">לא מקושר</span>
                          </SelectItem>
                          {funnels?.map(f => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-6 py-4">
                      {ad.ad_url && (
                        <Button variant="ghost" size="sm" asChild>
                           <a href={ad.ad_url} target="_blank" rel="noopener noreferrer" data-testid={`link-ad-facebook-${ad.id}`}>
                            <Megaphone className="w-4 h-4 ml-1" />
                            צפה בפייסבוק
                          </a>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredAds?.length && (
                  <tr>
                    <td colSpan={4} className="text-center p-8 text-muted-foreground">
                      לא נמצאו מודעות העונות על הסינון.
                    </td>
                  </tr>
                )}
          </CrmDataTable>
        )}
      </div>
    </Shell>
  );
}
