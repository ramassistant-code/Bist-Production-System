import { useEffect, useState } from "react";

// דף תודה ציבורי לאחר תשלום — ללא התחברות.
// Invoice4U מפנה לכאן עם ?token=<signing_request_token>.
// הדף קורא ל-POST /api/public/payment-return/:token שמאמת ושולח התראת WhatsApp.

const apiBase = ((import.meta.env.BASE_URL as string) ?? "").replace(/\/+$/, "");

type Status = "loading" | "paid" | "pending" | "error";

export default function PaymentDone() {
  const [status, setStatus] = useState<Status>("loading");
  const [amount, setAmount] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";

    if (!token) {
      setStatus("error");
      setErrorMsg("קישור לא תקין — חסר token.");
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/payment-return/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const j = (await res.json().catch(() => ({}))) as {
          status?: string;
          amount?: number;
          error?: string;
        };
        if (!alive) return;

        if (!res.ok) {
          setStatus("error");
          setErrorMsg(j.error ?? "שגיאה באימות התשלום");
          return;
        }

        if (j.status === "paid") {
          setStatus("paid");
          if (j.amount != null) setAmount(j.amount);
        } else {
          setStatus("pending");
        }
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "שגיאת רשת");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "sans-serif",
        backgroundColor: "#f8fafc",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "1rem",
          boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
          padding: "3rem 2.5rem",
          maxWidth: 440,
          width: "100%",
        }}
      >
        {status === "loading" && (
          <>
            <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⏳</div>
            <p style={{ color: "#64748b", fontSize: "1.1rem" }}>מאמת תשלום…</p>
          </>
        )}

        {status === "paid" && (
          <>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#16a34a", margin: "0 0 0.5rem" }}>
              התשלום התקבל, תודה!
            </h1>
            {amount != null && amount > 0 && (
              <p style={{ color: "#374151", fontSize: "1.1rem", margin: "0.5rem 0 0" }}>
                סכום שחויב:{" "}
                <strong>
                  {amount.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}₪
                </strong>
              </p>
            )}
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginTop: "1.25rem" }}>
              קיבלנו את תשלומך. צוות המכירות שלנו יצור עמך קשר בהקדם.
            </p>
          </>
        )}

        {status === "pending" && (
          <>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⏰</div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#92400e", margin: "0 0 0.5rem" }}>
              טרם זוהה תשלום
            </h1>
            <p style={{ color: "#64748b", fontSize: "1rem", marginTop: "0.75rem" }}>
              אם שילמת, נסה לרענן את הדף בעוד רגע.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#dc2626", margin: "0 0 0.5rem" }}>
              שגיאה
            </h1>
            <p style={{ color: "#64748b", fontSize: "1rem", marginTop: "0.75rem" }}>
              {errorMsg ?? "אירעה שגיאה לא צפויה. פנה אלינו לבירור."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
