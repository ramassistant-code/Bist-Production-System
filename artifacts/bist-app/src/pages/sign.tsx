import { useState, useEffect } from "react";
import { useParams } from "wouter";

// עמוד חתימה ציבורי — ללא התחברות. מציג את ה-PDF של ההצעה ומאפשר אישור/חתימה.

interface SigningData {
  status: "pending" | "signed" | "expired" | "cancelled" | string;
  customer_name: string;
  customer_email: string;
  quote_number: string | null;
  pdf_url: string | null;
  signed_at: string | null;
}

const apiBase = ((import.meta.env.BASE_URL as string) ?? "").replace(/\/+$/, "");

export default function SignPage() {
  const params = useParams();
  const token = String((params as { token?: string }).token ?? "");

  const [data, setData] = useState<SigningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/signing/${token}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "שגיאה בטעינת המסמך");
        if (!alive) return;
        setData(j as SigningData);
        if ((j as SigningData).customer_email) setEmail((j as SigningData).customer_email);
        if ((j as SigningData).status === "signed") setDone(true);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "שגיאה");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  async function submit() {
    setSubmitError(null);
    if (!name.trim()) {
      setSubmitError("יש להזין שם מלא");
      return;
    }
    if (!agree) {
      setSubmitError("יש לאשר את ההצעה בסימון התיבה");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/public/signing/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer_name: name.trim(),
          signer_id_number: idNumber.trim(),
          customer_note: "",
          signer_email: email.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "שגיאה בחתימה");
      setDone(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "שגיאה בחתימה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
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
          <div className="text-center py-16 text-muted-foreground">טוען מסמך…</div>
        )}

        {!loading && loadError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
            <p className="font-semibold text-destructive">לא ניתן להציג את המסמך</p>
            <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && data && (
          <>
            {done ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-8 text-center space-y-2">
                <div className="text-4xl">✅</div>
                <p className="text-lg font-semibold text-green-700">ההצעה נחתמה בהצלחה!</p>
                <p className="text-sm text-muted-foreground">תודה. ניצור איתך קשר להמשך התהליך 🙏🏻</p>
              </div>
            ) : data.status === "expired" ? (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
                <p className="font-semibold text-yellow-700">פג תוקף הקישור</p>
                <p className="text-sm text-muted-foreground mt-1">אנא פנה אלינו לקבלת קישור מעודכן.</p>
              </div>
            ) : data.status !== "pending" ? (
              <div className="rounded-lg border border-border bg-card p-6 text-center">
                <p className="font-semibold">הקישור אינו פעיל</p>
              </div>
            ) : (
              <>
                {data.customer_name && (
                  <p className="text-center text-base">
                    היי {data.customer_name} 👋 לפניך הצעת המחיר לחתימה
                  </p>
                )}

                {/* PDF */}
                <div className="rounded-lg border border-border overflow-hidden bg-card">
                  {data.pdf_url ? (
                    <iframe
                      title="הצעת מחיר"
                      src={data.pdf_url}
                      className="w-full"
                      style={{ height: "62vh" }}
                    />
                  ) : (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                      לא נמצא קובץ PDF להצגה.
                    </div>
                  )}
                </div>
                {data.pdf_url && (
                  <a
                    href={data.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-sm text-primary underline"
                  >
                    פתיחת ה-PDF בכרטיסייה חדשה
                  </a>
                )}

                {/* Signature form */}
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                  <h2 className="font-semibold">חתימה על ההצעה</h2>

                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">שם מלא *</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="שם מלא"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">תעודת זהות / ח.פ (אופציונלי)</label>
                    <input
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      inputMode="numeric"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="ת.ז / ח.פ"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">מייל — לקבלת העתק של הצעת המחיר (אופציונלי)</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      inputMode="email"
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="your@email.com"
                      dir="ltr"
                    />
                  </div>

                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agree}
                      onChange={(e) => setAgree(e.target.checked)}
                      className="mt-1"
                    />
                    <span>קראתי את הצעת המחיר, ואני מאשר/ת וחותם/ת עליה.</span>
                  </label>

                  {submitError && <p className="text-sm text-destructive">{submitError}</p>}

                  <button
                    onClick={submit}
                    disabled={submitting}
                    className="w-full h-11 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? "חותם…" : "אני חותם/ת על ההצעה"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
