const NAV = [
  { label: "דשבורד", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )},
  { label: "לקוחות", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )},
  { label: "מוצרים", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  )},
  { label: "רכיבים", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  )},
  { label: "הצעות מחיר", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
    </svg>
  )},
  { label: "הפקה", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  )},
  { label: "משימות", icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  )},
];

const PRODUCTS = [
  { num: "PRD-000001", name: "צילום פודקאסט", cat: "אולפן", price: "₪12,000", status: "פעיל" },
  { num: "PRD-000002", name: "סרטון תדמית", cat: "וידאו", price: "₪8,500", status: "פעיל" },
  { num: "PRD-000003", name: "תיעוד אירוע", cat: "אירועים", price: "₪5,200", status: "פעיל" },
  { num: "PRD-000004", name: "פרסומת טלוויזיה", cat: "וידאו", price: "₪22,000", status: "לא פעיל" },
];

export function IconSidebar() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-row-reverse font-sans" dir="rtl">
      {/* ── Slim icon sidebar (right, RTL) ── */}
      <aside className="w-14 bg-slate-900 flex flex-col items-center py-4 gap-1 shadow-xl flex-shrink-0">
        {/* Logo mark */}
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mb-4">
          <span className="text-white font-black text-sm leading-none">B</span>
        </div>

        {NAV.map((item, i) => {
          const active = item.label === "מוצרים";
          return (
            <div key={i} className="relative group w-full flex justify-center">
              <button
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all
                  ${active
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                    : "text-slate-400 hover:text-white hover:bg-slate-700"
                  }`}
                title={item.label}
              >
                {item.icon}
              </button>
              {/* Tooltip — positioned to the left (content side in RTL) */}
              <div className="absolute right-14 top-1/2 -translate-y-1/2 bg-slate-800 text-white text-xs px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap border border-slate-700 shadow-xl z-50">
                {item.label}
                <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-800 border-t border-r border-slate-700 rotate-45" />
              </div>
            </div>
          );
        })}

        {/* Spacer + settings at bottom */}
        <div className="flex-1" />
        <button className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 transition-all">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold mb-1">י</div>
      </aside>

      {/* ── Main content (wider now) ── */}
      <main className="flex-1 flex flex-col overflow-auto">
        {/* Minimal top strip */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">דשבורד</span>
            <span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900">מוצרים</span>
          </div>
          <div className="flex gap-3 items-center text-sm text-gray-400">
            <span>10 ביולי 2026</span>
          </div>
        </div>

        <div className="px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">מוצרים</h1>
              <p className="text-sm text-gray-400 mt-0.5">4 מוצרים פעילים</p>
            </div>
            <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
              <span className="text-lg leading-none">+</span>
              מוצר חדש
            </button>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "סה״כ מוצרים", val: "4", sub: "+1 החודש", color: "blue" },
              { label: "עלות ממוצעת", val: "₪4,200", sub: "מרכיבים", color: "purple" },
              { label: "שולי רווח ממוצע", val: "68%", sub: "מחיר / עלות", color: "green" },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 px-5 py-4 shadow-sm">
                <div className="text-2xl font-bold text-gray-900 mb-0.5">{s.val}</div>
                <div className="text-xs font-medium text-gray-600">{s.label}</div>
                <div className="text-xs text-gray-400 mt-1">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["מספר","שם המוצר","קטגוריה","מחיר מכירה","סטטוס",""].map((h,i)=>(
                    <th key={i} className="text-right py-3 px-4 font-semibold text-gray-500 text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRODUCTS.map((p, i) => (
                  <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/30 transition-colors cursor-pointer">
                    <td className="py-3 px-4 font-mono text-xs text-gray-400">{p.num}</td>
                    <td className="py-3 px-4 font-semibold text-gray-900">{p.name}</td>
                    <td className="py-3 px-4 text-gray-500">{p.cat}</td>
                    <td className="py-3 px-4 font-medium text-gray-800">{p.price}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        p.status === "פעיל" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                      }`}>{p.status}</span>
                    </td>
                    <td className="py-3 px-4">
                      <button className="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50">✏️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
