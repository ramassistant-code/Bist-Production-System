import { useMemo, useState } from "react";

const DOCK_ITEMS = [
  { label: "דשבורד", icon: "⌂" },
  { label: "לקוחות", icon: "◌" },
  { label: "מוצרים", icon: "▦" },
  { label: "רכיבים", icon: "◈" },
  { label: "הצעות מחיר", icon: "▤" },
  { label: "הפקה", icon: "◒" },
  { label: "משימות", icon: "✓" },
  { label: "הגדרות", icon: "◍" },
];

const PRODUCTS = [
  { num: "PRD-000001", name: "צילום פודקאסט", cat: "אולפן", price: "₪12,000", status: "פעיל", comps: 3, tone: "bg-sky-100 text-sky-700" },
  { num: "PRD-000002", name: "סרטון תדמית", cat: "וידאו", price: "₪8,500", status: "פעיל", comps: 5, tone: "bg-violet-100 text-violet-700" },
  { num: "PRD-000003", name: "תיעוד אירוע", cat: "אירועים", price: "₪5,200", status: "פעיל", comps: 2, tone: "bg-amber-100 text-amber-700" },
  { num: "PRD-000004", name: "פרסומת טלוויזיה", cat: "וידאו", price: "₪22,000", status: "לא פעיל", comps: 8, tone: "bg-rose-100 text-rose-700" },
];

export function BottomDockRefined() {
  const [activeNav, setActiveNav] = useState("מוצרים");
  const [query, setQuery] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const products = useMemo(
    () => PRODUCTS.filter((p) => `${p.name} ${p.cat} ${p.num}`.includes(query)),
    [query],
  );

  const addProduct = () => {
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 2400);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f8fc] text-[#14253d]" dir="rtl">
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#dceeff] opacity-70 blur-3xl" />
      <header className="relative flex items-center justify-between px-6 pb-1 pt-6 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#153b68] text-lg font-black text-white shadow-lg shadow-[#153b68]/20">B</div>
          <div className="leading-none">
            <div className="text-[15px] font-black tracking-[0.2em] text-[#153b68]">BIST</div>
            <div className="mt-1 text-[10px] font-medium text-[#8293a9]">מערכת הפקות</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden text-left text-[11px] leading-5 text-[#8293a9] sm:block">
            <div>יום חמישי, 10 ביולי 2026</div>
            <div className="font-semibold text-[#47627f]">סטודיו מרכז · מחובר</div>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-white bg-[#d8e8f7] text-sm font-bold text-[#153b68] shadow-sm">י</div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-[1440px] flex-1 px-6 pb-32 pt-8 sm:px-10">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#6c85a0]"><span>ניהול קטלוג</span><span className="text-[#b9c8d8]">/</span><span className="text-[#153b68]">מוצרים</span></div>
            <h1 className="text-[30px] font-black tracking-[-0.04em] text-[#14253d]">מוצרים</h1>
            <p className="mt-1 text-sm text-[#8293a9]">4 מוצרים · 3 פעילים · עודכנו לפני 12 דקות</p>
          </div>
          <button onClick={addProduct} className="flex shrink-0 items-center gap-2 rounded-xl bg-[#153b68] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-[#153b68]/20 transition-transform hover:-translate-y-0.5 active:translate-y-0">
            <span className="text-lg leading-none">+</span> מוצר חדש
          </button>
        </div>

        <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "מוצרים פעילים", val: "3", icon: "↗", color: "text-[#147f91]", bg: "bg-[#e5f5f3]" },
            { label: "הצעות פתוחות", val: "7", icon: "◫", color: "text-[#6a5bb4]", bg: "bg-[#eeeafe]" },
            { label: "הפקות השבוע", val: "2", icon: "◒", color: "text-[#b36d28]", bg: "bg-[#fff2de]" },
            { label: "משימות פתוחות", val: "12", icon: "✓", color: "text-[#4e7c56]", bg: "bg-[#e8f3e7]" },
          ].map((k) => (
            <div key={k.label} className="flex items-center justify-between rounded-2xl border border-[#e0e9f2] bg-white px-5 py-4 shadow-[0_8px_25px_rgba(27,58,92,0.04)]">
              <div><div className="text-[11px] font-semibold text-[#8293a9]">{k.label}</div><div className="mt-1 text-2xl font-black text-[#14253d]">{k.val}</div></div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-[15px] text-xl font-bold ${k.bg} ${k.color}`}>{k.icon}</div>
            </div>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#e0e9f2] bg-white shadow-[0_12px_35px_rgba(27,58,92,0.05)]">
          <div className="flex flex-col gap-3 border-b border-[#edf2f7] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-black text-[#14253d]">רשימת מוצרים</h2><p className="mt-0.5 text-xs text-[#9aabbd]">כל מה שהצוות שלך מוכר ומפיק</p></div>
            <div className="relative">
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#91a5bb]">⌕</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מוצר או מספר..." className="w-full rounded-xl border border-[#e2eaf2] bg-[#f8fafc] py-2.5 pl-3 pr-9 text-xs text-[#274361] outline-none transition focus:border-[#7ca8ca] focus:bg-white sm:w-60" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-right text-sm">
              <thead className="bg-[#f8fafc] text-[10px] font-bold tracking-wide text-[#8b9caf]"><tr>{["מספר", "שם המוצר", "קטגוריה", "רכיבים", "מחיר מכירה", "סטטוס", ""].map((h) => <th key={h} className="px-5 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {products.map((p) => <tr key={p.num} onClick={() => setSelected(p.num)} className={`group cursor-pointer border-t border-[#f0f4f8] transition-colors hover:bg-[#f5f9fd] ${selected === p.num ? "bg-[#f1f7fc]" : ""}`}>
                  <td className="px-5 py-4 font-mono text-[11px] text-[#9aabbd]">{p.num}</td><td className="px-5 py-4 font-bold text-[#213c59]">{p.name}</td><td className="px-5 py-4 text-[#71869d]">{p.cat}</td><td className="px-5 py-4"><span className={`rounded-md px-2 py-1 text-[11px] font-bold ${p.tone}`}>{p.comps} רכיבים</span></td><td className="px-5 py-4 font-bold text-[#304d69]">{p.price}</td><td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 text-xs font-bold ${p.status === "פעיל" ? "text-[#39815f]" : "text-[#9aabbd]"}`}><span className={`h-1.5 w-1.5 rounded-full ${p.status === "פעיל" ? "bg-[#54ad7c]" : "bg-[#b8c4cf]"}`} />{p.status}</span></td><td className="px-5 py-4 text-left"><button onClick={(e) => { e.stopPropagation(); setSelected(p.num); }} className="rounded-lg px-2 py-1 text-lg text-[#9badbe] opacity-0 transition hover:bg-[#eaf3fa] hover:text-[#153b68] group-hover:opacity-100">···</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {products.length === 0 && <div className="px-5 py-14 text-center text-sm text-[#8293a9]">לא נמצאו מוצרים התואמים לחיפוש</div>}
        </section>
      </main>

      <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-32px)] max-w-[720px] -translate-x-1/2">
        <nav className="flex items-center justify-between gap-1 rounded-[20px] border border-white/80 bg-white/90 px-2 py-2 shadow-[0_16px_40px_rgba(27,58,92,0.18)] backdrop-blur-xl sm:justify-center sm:gap-2 sm:px-3">
          {DOCK_ITEMS.map((item) => <button key={item.label} title={item.label} onClick={() => setActiveNav(item.label)} className={`group relative flex h-11 min-w-9 flex-1 items-center justify-center rounded-[14px] text-lg transition-all sm:w-12 sm:flex-none ${activeNav === item.label ? "bg-[#153b68] text-white shadow-md shadow-[#153b68]/25" : "text-[#7890a8] hover:bg-[#edf4fa] hover:text-[#153b68]"}`}><span>{item.icon}</span><span className={`absolute -top-10 hidden whitespace-nowrap rounded-lg bg-[#14253d] px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg group-hover:block ${activeNav === item.label ? "sm:block" : ""}`}>{item.label}</span></button>)}
        </nav>
      </div>
      {showToast && <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-[#153b68] px-4 py-3 text-xs font-bold text-white shadow-xl">טופס מוצר חדש מוכן להוספה</div>}
    </div>
  );
}