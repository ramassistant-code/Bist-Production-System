import { Link, useLocation } from "wouter";
import { Users, Box, Layers, FileSignature, Settings, Target, Handshake, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { name: "לידים", href: "/leads", icon: Target },
  { name: "לקוחות", href: "/customers", icon: Users },
  { name: "מוצרים", href: "/products", icon: Box },
  { name: "רכיבים", href: "/components", icon: Layers },
  { name: "הצעות מחיר", href: "/quotes", icon: FileSignature },
  { name: "עסקאות", href: "/deals", icon: Handshake },
  { name: "וואטסאפ עורך", href: "/production", icon: MessageCircle },
  { name: "הגדרות", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="w-64 bg-sidebar text-sidebar-foreground flex flex-col h-full border-l border-sidebar-border">
      <div className="h-16 flex items-center gap-2.5 px-6 border-b border-sidebar-border/60">
        <span className="text-2xl font-black tracking-tight text-sidebar-foreground">
          BI<span className="text-primary">S</span>T
        </span>
        <span className="text-sidebar-foreground/60 text-sm font-medium">מערכת הפקות</span>
      </div>
      <nav className="flex-1 py-5 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
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
            </Link>
          );
        })}
      </nav>
      <div className="px-6 py-4 border-t border-sidebar-border/60">
        <p className="text-[11px] leading-tight text-sidebar-foreground/40">
          BIST — Businesses · Innovation · Startups · Technology
        </p>
      </div>
    </div>
  );
}
