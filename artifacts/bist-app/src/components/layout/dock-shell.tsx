import { ReactNode } from "react";
import { BottomDock } from "./bottom-dock";
import { useAuth } from "@/lib/auth-context";
import { useLayout } from "@/lib/layout-context";
import { PanelLeft } from "lucide-react";

interface DockShellProps {
  title: string;
  children: ReactNode;
  badge?: string;
  noPadding?: boolean;
}

export function DockShell({ title, badge, children, noPadding }: DockShellProps) {
  const { appUser } = useAuth();
  const { toggle } = useLayout();

  const initials = appUser?.full_name
    ? appUser.full_name.charAt(0)
    : appUser?.email?.charAt(0) ?? "?";

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden text-[#14253d]"
      style={{ background: "#f5f8fc" }}
      dir="rtl"
    >
      {/* Ambient blob */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#dceeff] opacity-60 blur-3xl" />

      {/* Header */}
      <header className="relative flex items-center justify-between px-6 pb-1 pt-5 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#153b68] text-lg font-black text-white shadow-lg shadow-[#153b68]/20">
            B
          </div>
          <div className="leading-none">
            <div className="text-[15px] font-black tracking-[0.2em] text-[#153b68]">BIST</div>
            <div className="mt-1 text-[10px] font-medium text-[#8293a9]">מערכת הפקות</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Switch back to sidebar */}
          <button
            onClick={toggle}
            title="חזרה לניווט צד"
            className="flex items-center gap-1.5 rounded-lg border border-[#e0e9f2] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6c85a0] shadow-sm transition hover:border-[#c6d9ea] hover:text-[#153b68]"
          >
            <PanelLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ניווט צד</span>
          </button>

          {/* User avatar */}
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-white bg-[#d8e8f7] text-sm font-bold text-[#153b68] shadow-sm"
            title={appUser?.full_name ?? appUser?.email ?? ""}
          >
            {initials}
          </div>
        </div>
      </header>

      {/* Page title bar */}
      <div className="relative mx-auto w-full max-w-[1440px] px-6 pt-7 sm:px-10">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[#8293a9]">
          <span>BIST</span>
          <span className="text-[#b9c8d8]">/</span>
          <span className="text-[#153b68]">{title}</span>
        </div>
        <h1 className="text-[28px] font-black tracking-[-0.04em] text-[#14253d]">
          {title}
          {badge && (
            <span className="mr-3 text-sm font-normal text-[#8293a9]">{badge}</span>
          )}
        </h1>
      </div>

      {/* Main content */}
      <main
        className={
          noPadding
            ? "relative mx-auto w-full max-w-[1440px] flex-1 pb-28"
            : "relative mx-auto w-full max-w-[1440px] flex-1 px-6 pb-28 pt-6 sm:px-10"
        }
      >
        {children}
      </main>

      <BottomDock />
    </div>
  );
}
