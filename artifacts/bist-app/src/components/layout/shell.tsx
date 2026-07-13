import { ReactNode } from "react";
import { Sidebar } from "./sidebar";

interface ShellProps {
  title: string;
  children: ReactNode;
}

export function Shell({ title, children }: ShellProps) {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center px-8 bg-card border-b border-border shrink-0">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        </header>
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
