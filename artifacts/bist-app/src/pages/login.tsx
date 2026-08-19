import { useState, FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import versionInfo from "@/version.json";
import { isTestEnvironment } from "@/lib/environment";

const API_BASE = `${import.meta.env.BASE_URL}api`;

type Mode = "password" | "otp-email" | "otp-code";

export default function Login() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await signIn(email, password);
    if (err) setError(err);
    setLoading(false);
  };

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "שגיאה בשליחת הקוד");
      } else {
        setInfo("אם קיים משתמש עם כתובת זו — נשלח אליו קוד למייל");
        setMode("otp-code");
      }
    } catch {
      setError("שגיאת תקשורת — נסה שוב");
    }
    setLoading(false);
  };

  const verifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "קוד שגוי");
        setLoading(false);
        return;
      }
      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "email",
      });
      if (otpErr) {
        setError("שגיאה בכניסה — נסה שוב");
        setLoading(false);
        return;
      }
      // auth-context מאזין לשינוי ה-session ויכניס אוטומטית
    } catch {
      setError("שגיאת תקשורת — נסה שוב");
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";
  const buttonClass =
    "w-full bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors";

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-background flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm bg-card border border-card-border rounded-2xl shadow-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl font-black tracking-tight text-foreground">
            BI<span className="text-primary">S</span>T
          </div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-lg font-bold text-foreground">מערכת הפקות</h1>
            {isTestEnvironment && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                סביבת פיתוח
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">התחברות למערכת</p>
        </div>

        {mode === "password" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                אימייל
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="name@bist.co.il"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                סיסמה
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className={buttonClass}>
              {loading ? "מתחבר..." : "התחברות"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setInfo(null);
                setMode("otp-email");
              }}
              className="w-full text-sm text-primary hover:underline"
            >
              היכנס באמצעות קוד למייל
            </button>
          </form>
        )}

        {mode === "otp-email" && (
          <form onSubmit={requestCode} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                אימייל
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="name@bist.co.il"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className={buttonClass}>
              {loading ? "שולח..." : "שלח לי קוד למייל"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("password");
              }}
              className="w-full text-sm text-muted-foreground hover:underline"
            >
              חזרה לכניסה עם סיסמה
            </button>
          </form>
        )}

        {mode === "otp-code" && (
          <form onSubmit={verifyCode} className="space-y-4">
            {info && (
              <p className="text-sm text-foreground bg-primary/10 border border-primary/30 rounded-lg px-3 py-2">
                {info}
              </p>
            )}

            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground">
                קוד בן 6 ספרות
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center tracking-[0.5em] text-lg font-bold`}
                placeholder="••••••"
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading || code.length !== 6} className={buttonClass}>
              {loading ? "בודק..." : "כניסה"}
            </button>

            <div className="flex justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setCode("");
                  setMode("otp-email");
                }}
                className="text-primary hover:underline"
              >
                שלח קוד חדש
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setCode("");
                  setMode("password");
                }}
                className="text-muted-foreground hover:underline"
              >
                כניסה עם סיסמה
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground/50 pt-2">
          גרסה {versionInfo.version}
        </p>
      </div>
    </div>
  );
}
