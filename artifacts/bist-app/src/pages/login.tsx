import { useState, FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-background flex items-center justify-center p-4"
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-md p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-foreground">BIST מערכת הפקות</h1>
          <p className="text-sm text-muted-foreground">התחברות למערכת</p>
        </div>

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
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
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
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
          >
            {loading ? "מתחבר..." : "התחברות"}
          </button>
        </form>
      </div>
    </div>
  );
}
