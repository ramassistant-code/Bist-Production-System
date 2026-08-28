import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export type CrmViewMode = "rep" | "manager";

export function useCrmView() {
  const { appUser } = useAuth();
  const isManager =
    appUser?.role === "admin" || appUser?.role === "sales_manager";
  const storageKey = useMemo(
    () => `bist.crm.view.${appUser?.id ?? "anonymous"}`,
    [appUser?.id],
  );

  const [view, setView] = useState<CrmViewMode>(() => {
    if (!isManager) return "rep";
    try {
      return localStorage.getItem(storageKey) === "manager" ? "manager" : "rep";
    } catch {
      return "rep";
    }
  });

  useEffect(() => {
    if (!isManager) {
      setView("rep");
      return;
    }
    try {
      const stored = localStorage.getItem(storageKey);
      setView(stored === "manager" ? "manager" : "rep");
    } catch {
      setView("rep");
    }
  }, [isManager, storageKey]);

  const updateView = (next: CrmViewMode) => {
    const safeView = isManager ? next : "rep";
    setView(safeView);
    if (isManager) {
      try {
        localStorage.setItem(storageKey, safeView);
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
    }
  };

  return { view, setView: updateView, isManager };
}
