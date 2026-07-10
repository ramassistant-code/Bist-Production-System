const DOCK_ITEMS = [
  { label: "דשבורד", icon: "⊞" },
  { label: "לקוחות", icon: "👥" },
  { label: "מוצרים", icon: "📦" },
  { label: "רכיבים", icon: "🔩" },
  { label: "הצעות מחיר", icon: "📝" },
  { label: "הפקה", icon: "🎬" },
  { label: "משימות", icon: "✅" },
  { label: "הגדרות", icon: "⚙️" },
];

const PRODUCTS = [
  { num: "PRD-000001", name: "צילום פודקאסט", cat: "אולפן", price: "₪12,000", status: "פעיל", comps: 3 },
  { num: "PRD-000002", name: "סרטון תדמית", cat: "וידאו", price: "₪8,500", status: "פעיל", comps: 5 },
  { num: "PRD-000003", name: "תיעוד אירוע", cat: "אירועים", price: "₪5,200", status: "פעיל", comps: 2 },
  { num: "PRD-000004", name: "פרסומת טלוויזיה", cat: "וידאו", price: "₪22,000", status: "לא פעיל", comps: 8 },
];

export function BottomDock() {
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 flex flex-col font-sans relative"
      dir="rtl"
    >
      {/* ── Full-bleed header — just a logo + user ── */}
      <header className="flex items-center justify-between px-8 pt-5 pb-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-200">
            <span className="text-white font-black text-sm">B</span>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800 leading-tight">BIST</div>
            <div className="text-[10px] text-slate-400 leading-tight">מערכת הפקות</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">יום חמישי, 10 ביולי 2026</span>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-bold shadow-md">
            י
          </div>
        </div>
      </header>

      {/* ── Page content — full width, no sidebar ── */}
      <main className="flex-1 px-8 py-5 pb-28">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">מוצרים</h1>
            <p className="text-sm text-slate-400 mt-0.5">4 מוצרים · 3 פעילים</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-colors shadow-md shadow-blue-200">
            <span className="text-lg leading-none">+</span>
            מוצר חדש
          </button>
        </div>

        {/* KPI cards — more prominent since there's no sidebar to compete */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "מוצרים פעילים", val: "3", icon: "📦", bg: "from-blue-500 to-blue-600" },
            { label: "הצעות פתוחות", val: "7", icon: "📝", bg: "from-violet-500 to-violet-600" },
            { label: "הפקות השבוע", val: "2", icon: "🎬", bg: "from-amber-500 to-orange-500" },
            { label: "משימות פתוחות", val: "12", icon: "✅", bg: "from-emerald-500 to-green-600" },
          ].map((k, i) => (
            <div
              key={i}
              className={`bg-gradient-to-br ${k.bg} rounded-2xl p-5 text-white shadow-lg`}
            >
              <div className="text-2xl mb-1">{k.icon}</div>
              <div className="text-3xl font-black">{k.val}</div>
              <div className="text-xs font-medium opacity-80 mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Products table — full width feels expansive */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">רשימת מוצרים</h2>
            <input
              readOnly
              placeholder="חיפוש..."
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-48 text-gray-400 bg-gray-50"
            />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50/80">
              <tr>
                {["מספר","שם המוצר","קטגוריה","רכיבים","מחיר מכירה","סטטוס",""].map((h,i)=>(
                  <th key={i} className="text-right py-3 px-4 font-semibold text-gray-500 text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p, i) => (
                <tr key={i} className="border-t border-gray-50 hover:bg-blue-50/40 transition-colors cursor-pointer group">
                  <td className="py-3.5 px-4 font-mono text-xs text-gray-400">{p.num}</td>
                  <td className="py-3.5 px-4 font-semibold text-gray-900">{p.name}</td>
                  <td className="py-3.5 px-4 text-gray-500">{p.cat}</td>
                  <td className="py-3.5 px-4">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p.comps} רכיבים</span>
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-gray-800">{p.price}</td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      p.status === "פעיל" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}>{p.status}</span>
                  </td>
                  <td className="py-3.5 px-4">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50">
                      ✏️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── Floating bottom dock ── */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
        <div className="bg-white/90 backdrop-blur-xl border border-white shadow-2xl shadow-slate-300/50 rounded-2xl px-3 py-2 flex items-center gap-1">
          {DOCK_ITEMS.map((item, i) => {
            const active = item.label === "מוצרים";
            return (
              <div key={i} className="relative group">
                <button
                  className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl transition-all
                    ${active
                      ? "bg-blue-600 shadow-lg shadow-blue-200 scale-110"
                      : "hover:bg-gray-100 hover:scale-105"
                    }`}
                >
                  {item.icon}
                </button>
                {/* Active dot */}
                {active && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-blue-600 rounded-full" />
                )}
                {/* Tooltip above */}
                <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xl">
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
