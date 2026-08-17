import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { DockShell } from "./dock-shell";
import { useLayout } from "@/lib/layout-context";

interface ShellProps {
  title: string;
  children: ReactNode;
  /** Optional small badge shown next to the title in the header */
  badge?: string;
  /** When true, removes the default p-8 padding from <main> so the page can control its own layout */
  noPadding?: boolean;
}

export function Shell({ title, badge, children, noPadding }: ShellProps) {
  const { mode } = useLayout();

  if (mode === "dock") {
    return (
      <DockShell title={title} badge={badge} noPadding={noPadding}>
        {children}
      </DockShell>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center gap-3 px-8 bg-card border-b border-border shrink-0">
          <span className="h-5 w-1 rounded-full bg-primary shrink-0" aria-hidden />
          <h1 className="text-xl font-black tracking-tight text-foreground">{title}</h1>
          {badge && (
            <span className="text-xs text-muted-foreground/60 font-normal">{badge}</span>
          )}
        </header>
        <main className={`flex-1 overflow-hidden${noPadding ? "" : " p-8 overflow-y-auto"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
