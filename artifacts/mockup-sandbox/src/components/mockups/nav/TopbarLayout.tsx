const NAV_GROUPS = [
  {
    items: [
      { label: "דשבורד", icon: "⊞" },
      { label: "לקוחות", icon: "👥" },
      { label: "מוצרים", icon: "📦" },
      { label: "רכיבים", icon: "🔩" },
    ],
  },
  {
    items: [
      { label: "הצעות מחיר", icon: "📝" },
      { label: "הפקה", icon: "🎬" },
      { label: "משימות", icon: "✅" },
    ],
  },
];

const PRODUCTS = [
  { num: "PRD-000001", name: "צילום פודקאסט", cat: "אולפן", price: "₪12,000", status: "פעיל" },
  { num: "PRD-000002", name: "סרטון תדמית", cat: "וידאו", price: "₪8,500", status: "פעיל" },
  { num: "PRD-000003", name: "תיעוד אירוע", cat: "אירועים", price: "₪5,200", status: "פעיל" },
  { num: "PRD-000004", name: "פרסומת טלוויזיה", cat: "וידאו", price: "₪22,000", status: "לא פעיל" },
];

export function TopbarLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans" dir="rtl">
      {/* ── Top bar ── */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-0 shadow-sm z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 ml-8">
          <span className="text-xl font-bold text-slate-800 tracking-tight">BIST</span>
          <span className="text-xs text-gray-400 leading-tight">מערכת<br/>הפקות</span>
        </div>

        {/* Nav groups */}
        <nav className="flex items-center gap-1 flex-1">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="flex items-center">
              {gi > 0 && <div className="w-px h-5 bg-gray-200 mx-2" />}
              {group.items.map((item, i) => {
                const active = item.label === "מוצרים";
                return (
                  <button
                    key={i}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                      ${active
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                  >
                    <span className="text-xs">{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Right side actions */}
        <div className="flex items-center gap-3 mr-4">
          <button className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">
            הגדרות
          </button>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
            י
          </div>
        </div>
      </header>

      {/* ── Active page indicator ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-2">
        <span className="text-xs text-gray-400">דשבורד</span>
        <span className="text-xs text-gray-300">/</span>
        <span className="text-xs font-semibold text-gray-700">מוצרים</span>
      </div>

      {/* ── Page content ── */}
      <main className="flex-1 px-6 py-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">מוצרים</h1>
          <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2 transition-colors">
            <span className="text-base leading-none">+</span>
            מוצר חדש
          </button>
        </div>

        <div className="flex gap-3 mb-5">
          <input
            readOnly
            placeholder="חיפוש לפי שם או קטגוריה..."
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 bg-white text-gray-400"
          />
          <select className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600">
            <option>כל המוצרים</option>
          </select>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["מספר","שם המוצר","קטגוריה","מחיר מכירה","סטטוס",""].map((h,i)=>(
                  <th key={i} className="text-right py-3 px-4 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map((p, i) => (
                <tr key={i} className={`border-t border-gray-100 hover:bg-blue-50/30 transition-colors cursor-pointer ${i===0 ? "bg-blue-50/20" : ""}`}>
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
          <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">4 מוצרים</div>
        </div>
      </main>
    </div>
  );
}
