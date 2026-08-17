import { Link, useLocation } from "wouter";
import { Target, Users, Box, Layers, FileSignature, Handshake, MessageCircle, Settings, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

const DOCK_ITEMS = [
  { name: "לידים",        href: "/leads",      icon: Target },
  { name: "לקוחות",      href: "/customers",  icon: Users },
  { name: "מוצרים",      href: "/products",   icon: Box },
  { name: "רכיבים",      href: "/components", icon: Layers },
  { name: "הצעות מחיר", href: "/quotes",     icon: FileSignature },
  { name: "עסקאות",      href: "/deals",      icon: Handshake },
  { name: "הפקה",        href: "/production", icon: MessageCircle },
  { name: "משימות",      href: "/tasks",      icon: CheckSquare },
  { name: "הגדרות",      href: "/settings",   icon: Settings },
];

export function BottomDock() {
  const [location] = useLocation();

  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-32px)] max-w-[800px] -translate-x-1/2">
      <nav
        dir="rtl"
        className="flex items-center justify-between gap-1 rounded-[20px] border border-white/80 bg-white/90 px-2 py-2 shadow-[0_16px_40px_rgba(27,58,92,0.18)] backdrop-blur-xl sm:justify-center sm:gap-1.5 sm:px-3"
      >
        {DOCK_ITEMS.map((item) => {
          const isActive =
            location === item.href || location.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <button
                title={item.name}
                className={cn(
                  "group relative flex h-11 w-11 flex-col items-center justify-center rounded-[14px] transition-all",
                  isActive
                    ? "bg-[#153b68] text-white shadow-md shadow-[#153b68]/25"
                    : "text-[#7890a8] hover:bg-[#edf4fa] hover:text-[#153b68]"
                )}
              >
                <Icon className="h-5 w-5" />
                {/* Tooltip */}
                <span className="absolute -top-10 hidden whitespace-nowrap rounded-lg bg-[#14253d] px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg group-hover:block">
                  {item.name}
                </span>
              </button>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
