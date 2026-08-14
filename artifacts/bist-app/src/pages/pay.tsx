import { useState, useEffect } from "react";
import { useParams } from "wouter";

// עמוד פרטי חשבונית ציבורי — ללא התחברות.
// מציג טופס לאימות/עריכת פרטי חשבונית לפני הפניה לדף הסליקה.

interface PayData {
  status: "pending" | "paid" | string;
  quote_number: string | null;
  amount: number | null;
  invoice_name: string;
  invoice_tax_id: string;
  invoice_email: string;
}

const apiBase = ((import.meta.env.BASE_URL as string) ?? "").replace(/\/+$/, "");

function fmtILS(n: number | null | undefined) {
  if (n == null) return "—";
  return `₪${Number(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PayPage() {
  const params = useParams();
  const token = String((params as { token?: string }).token ?? "");

  const [data, setData] = useState<PayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [invoiceName, setInvoiceName] = useState("");
  const [invoiceTaxId, setInvoiceTaxId] = useState("");
  const [invoiceEmail, setInvoiceEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/pay/${token}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((j as { error?: string }).error || "שגיאה בטעינה");
        if (!alive) return;
        const d = j as PayData;
        setData(d);
        setInvoiceName(d.invoice_name ?? "");
        setInvoiceTaxId(d.invoice_tax_id ?? "");
        setInvoiceEmail(d.invoice_email ?? "");
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "שגיאה");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function submit() {
    setSubmitError(null);
    if (!invoiceName.trim()) { setSubmitError("יש להזין שם לחשבונית"); return; }
    if (!invoiceEmail.trim() || !invoiceEmail.includes("@")) {
      setSubmitError("יש להזין כתובת מייל תקינה"); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/public/pay/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_name: invoiceName.trim(),
          invoice_tax_id: invoiceTaxId.trim(),
          invoice_email: invoiceEmail.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((j as { error?: string }).error || "שגיאה");
      const { clearing_url } = j as { clearing_url: string };
      if (!clearing_url) throw new Error("לא התקבל לינק סליקה");
      window.location.href = clearing_url;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "שגיאה");
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="text-2xl font-black tracking-tight">
            BIST<span className="text-primary">.</span>
          </div>
          {data?.quote_number && (
            <p className="text-sm text-muted-foreground">הצעת מחיר {data.quote_number}</p>
          )}
        </div>

        {loading && (
          <div className="text-center py-16 text-muted-foreground">טוען…</div>
        )}

        {!loading && loadError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
            <p className="font-semibold text-destructive">לא ניתן לטעון את הדף</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && data && (
          <>
            {data.status === "paid" ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-8 text-center space-y-2">
                <div className="text-4xl">✅</div>
                <p className="text-lg font-semibold text-green-700">התשלום כבר בוצע</p>
                <p className="text-sm text-muted-foreground">תודה — ניצור איתך קשר להמשך 🙏🏻</p>
              </div>
            ) : data.status === "expired" ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-8 text-center space-y-2">
                <div className="text-4xl">⏰</div>
                <p className="text-lg font-semibold text-amber-700">פג תוקף הקישור</p>
                <p className="text-sm text-muted-foreground">הקישור לתשלום אינו בתוקף עוד. אנא פנה אלינו לקבלת קישור חדש.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card p-6 space-y-5">

                {/* סכום */}
                {data.amount != null && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">סכום לתשלום</p>
                    <p className="text-3xl font-black text-primary">{fmtILS(data.amount)}</p>
                    <p className="text-xs text-muted-foreground mt-1">כולל מע״מ</p>
                  </div>
                )}

                <h2 className="font-semibold text-base">פרטי חשבונית</h2>
                <p className="text-sm text-muted-foreground -mt-3">
                  אנא בדוק/י ועדכן/י — חשבונית תישלח למייל בסיום התשלום.
                </p>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">שם לחשבונית *</label>
                    <input
                      value={invoiceName}
                      onChange={(e) => setInvoiceName(e.target.value)}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="שם מלא / שם עסק"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">ת״ז / ח״פ (אופציונלי)</label>
                    <input
                      value={invoiceTaxId}
                      onChange={(e) => setInvoiceTaxId(e.target.value)}
                      inputMode="numeric"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="מספר ת.ז / ח.פ"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">מייל לקבלת חשבונית *</label>
                    <input
                      value={invoiceEmail}
                      onChange={(e) => setInvoiceEmail(e.target.value)}
                      type="email"
                      inputMode="email"
                      dir="ltr"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="your@email.com"
                    />
                  </div>
                </div>

                {submitError && (
                  <p className="text-sm text-destructive">{submitError}</p>
                )}

                <button
                  onClick={submit}
                  disabled={submitting}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {submitting ? "מעביר לדף תשלום…" : `המשך לתשלום ${data.amount != null ? fmtILS(data.amount) : ""}`}
                </button>

                <p className="text-xs text-center text-muted-foreground">
                  לאחר לחיצה תועבר/י לדף סליקה מאובטח של Invoice4U
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
