import { Link, useLocation } from "wouter";
import { Users, Box, Layers, FileSignature, Settings, Target, Handshake, MessageCircle, ClipboardList, LogOut, CalendarCheck, Funnel, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { isTestEnvironment } from "@/lib/environment";
import { useListMyCrmTasks, getListMyCrmTasksQueryKey } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { name: "מרכז CRM", href: "/crm/leads", icon: Target },
  { name: "משפכים", href: "/crm/funnels", icon: Funnel, adminOnly: true },
  { name: "מודעות", href: "/crm/ads", icon: Megaphone, adminOnly: true },
  { name: "זמינות", href: "/crm/availability", icon: CalendarCheck, managerOnly: true },
  { name: "לידים", href: "/leads", icon: Target },
  { name: "לקוחות", href: "/customers", icon: Users },
  { name: "מוצרים", href: "/products", icon: Box },
  { name: "רכיבים", href: "/components", icon: Layers },
  { name: "הצעות מחיר", href: "/quotes", icon: FileSignature },
  { name: "עסקאות", href: "/deals", icon: Handshake },
  { name: "משימות", href: "/tasks", icon: ClipboardList },
  { name: "וואטסאפ עורך", href: "/production", icon: MessageCircle },
  { name: "הגדרות", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const { appUser, signOut } = useAuth();
  const role = appUser?.role?.trim().toLowerCase();
  const isAdmin = role === "admin" || role === "מנהל";
  const isManager =
    role === "sales_manager" || role === "מנהל מכירות" || isAdmin;
  const { data: myTasks } = useListMyCrmTasks({
    query: { queryKey: getListMyCrmTasksQueryKey(), refetchInterval: 60_000 },
  });
  const visibleNavItems = NAV_ITEMS.filter(
    (item) =>
      (!item.managerOnly || isManager) &&
      (!item.adminOnly || isAdmin),
  );

  return (
    <div className="w-64 bg-sidebar text-sidebar-foreground flex flex-col h-full border-l border-sidebar-border">
      <div className="min-h-16 flex items-center gap-2.5 px-6 py-3 border-b border-sidebar-border/60">
        <span className="text-2xl font-black tracking-tight text-sidebar-foreground">
          BI<span className="text-primary">S</span>T
        </span>
        <div className="flex flex-col items-start">
          <span className="text-sidebar-foreground/60 text-sm font-medium">מערכת הפקות</span>
          {isTestEnvironment && (
            <span className="mt-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              סביבת פיתוח
            </span>
          )}
        </div>
      </div>
      <nav className="flex-1 py-5 px-3 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const isActive =
            item.href === "/"
              ? location === "/"
              : location === item.href || location.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span>{item.name}</span>
              {item.href === "/crm/leads" && Boolean(myTasks?.length) && (
                <span className="mr-auto min-w-5 rounded-full bg-destructive px-1.5 py-0.5 text-center text-[10px] font-bold text-destructive-foreground">
                  {myTasks?.length}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      {appUser && (
        <div className="px-3 py-3 border-t border-sidebar-border/60 space-y-1">
          <div className="px-3 py-1.5">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {appUser.full_name || appUser.email}
            </p>
            {appUser.full_name && (
              <p className="text-[11px] text-sidebar-foreground/50 truncate">{appUser.email}</p>
            )}
          </div>
          <button
            onClick={() => void signOut()}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>התנתק</span>
          </button>
        </div>
      )}

      <div className="px-6 py-3 border-t border-sidebar-border/60">
        <p className="text-[11px] leading-tight text-sidebar-foreground/40">
          BIST — Businesses · Innovation · Startups · Technology
        </p>
      </div>
    </div>
  );
}
