import { createContext, useContext, useState, ReactNode, useCallback } from "react";

export type LayoutMode = "sidebar" | "dock";

const STORAGE_KEY = "bist-layout-mode";

function getStoredMode(): LayoutMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dock" || v === "sidebar") return v;
  } catch {}
  return "sidebar";
}

interface LayoutContextValue {
  mode: LayoutMode;
  toggle: () => void;
  setMode: (m: LayoutMode) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>(getStoredMode);

  const setMode = useCallback((m: LayoutMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch {}
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "sidebar" ? "dock" : "sidebar");
  }, [mode, setMode]);

  return (
    <LayoutContext.Provider value={{ mode, toggle, setMode }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout must be used inside LayoutProvider");
  return ctx;
}
