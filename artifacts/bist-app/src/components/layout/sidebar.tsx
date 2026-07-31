import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Box, Layers, FileSignature, Settings, Target, Handshake, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { name: "דשבורד", href: "/", icon: LayoutDashboard },
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
      <div className="h-16 flex items-center px-6 font-bold text-xl tracking-wide border-b border-sidebar-border/50">
        <span className="text-primary-foreground">BIST</span>
        <span className="text-sidebar-foreground/70 mr-2 text-sm font-normal">מערכת הפקות</span>
      </div>
      <nav className="flex-1 py-6 px-3 space-y-1">
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
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
