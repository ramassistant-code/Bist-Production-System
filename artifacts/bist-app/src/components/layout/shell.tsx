import { ReactNode } from "react";
import { Sidebar } from "./sidebar";

interface ShellProps {
  title: string;
  children: ReactNode;
  /** When true, removes the default p-8 padding from <main> so the page can control its own layout */
  noPadding?: boolean;
}

export function Shell({ title, children, noPadding }: ShellProps) {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center px-8 bg-card border-b border-border shrink-0">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        </header>
        <main className={`flex-1 overflow-hidden${noPadding ? "" : " p-8 overflow-y-auto"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
