import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import { FileText, RefreshCw, Plus, Pencil, Trash2, X, KeyRound, ShieldCheck } from "lucide-react";
import versionInfo from "@/version.json";

interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string | null;
  is_active: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "מנהל",
  sales: "מכירות",
  studio_manager: "מנהל סטודיו",
  editor: "עורך",
  office_manager: "מנהל משרד",
  editing_manager: "מנהל עריכה",
};

const ROLE_OPTIONS = [
  { value: "admin", label: "מנהל" },
  { value: "sales", label: "מכירות" },
  { value: "studio_manager", label: "מנהל סטודיו" },
  { value: "editor", label: "עורך" },
  { value: "office_manager", label: "מנהל משרד" },
  { value: "editing_manager", label: "מנהל עריכה" },
];

function useAuthedFetch() {
  const { session } = useAuth();
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "שגיאה");
    }
    return res.json();
  };
}

/* ── User Form Dialog ──────────────────────────────────────────────── */

interface UserFormDialogProps {
  user?: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
  authedFetch: ReturnType<typeof useAuthedFetch>;
}

function UserFormDialog({ user, onClose, onSaved, authedFetch }: UserFormDialogProps) {
  const isEdit = !!user;
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail]       = useState(user?.email ?? "");
  const [phone, setPhone]       = useState(user?.phone ?? "");
  const [role, setRole]         = useState(user?.role ?? "");
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setError("כתובת אימייל לא תקינה"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await authedFetch(`/api/admin/users/${user!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ full_name: fullName, email, phone, role, is_active: isActive }),
        });
      } else {
        await authedFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ full_name: fullName, email, phone, role, is_active: isActive }),
        });
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message ?? "שגיאה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div dir="rtl" className="bg-card rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? "עריכת משתמש" : "משתמש חדש"}
          </h2>
          <button onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="block text-sm font-medium">שם מלא</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="ישראל ישראלי"
                disabled={saving}
              />
            </div>

            <div className="col-span-2 space-y-1">
              <label className="block text-sm font-medium">אימייל <span className="text-destructive">*</span></label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="name@bist.co.il"
                disabled={saving}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium">טלפון</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="05X-XXXXXXX"
                disabled={saving}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium">תפקיד</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={saving}
              >
                <option value="">— ללא —</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2 flex items-center gap-3">
              <input
                type="checkbox"
                id="is_active"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                disabled={saving}
              />
              <label htmlFor="is_active" className="text-sm font-medium cursor-pointer">
                משתמש פעיל
              </label>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            ביטול
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground rounded-lg transition-colors"
          >
            {saving ? "שומר..." : isEdit ? "שמור שינויים" : "צור משתמש"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Set Password Dialog ───────────────────────────────────────────── */

function SetPasswordDialog({ user, onClose, authedFetch }: {
  user: AppUser; onClose: () => void; authedFetch: ReturnType<typeof useAuthedFetch>;
}) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [success, setSuccess]   = useState(false);

  const mutation = useMutation({
    mutationFn: async (pw: string) => authedFetch(`/api/admin/users/${user.id}/set-password`, {
      method: "POST", body: JSON.stringify({ password: pw }),
    }),
    onSuccess: () => { setSuccess(true); qc.invalidateQueries({ queryKey: ["users"] }); },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div dir="rtl" className="bg-card rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">הגדר סיסמה ראשונית</h2>
          <button onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground mb-4">
            משתמש: <span className="font-medium text-foreground">{user.full_name ?? user.email}</span>
          </p>

          {success ? (
            <div className="space-y-3">
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                הסיסמה הוגדרה בהצלחה.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="block text-sm font-medium">סיסמה חדשה</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="לפחות 8 תווים"
                autoFocus
              />
              {mutation.isError && (
                <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-2">
                  {(mutation.error as Error)?.message ?? "שגיאה"}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            {success ? "סגור" : "ביטול"}
          </button>
          {!success && (
            <button
              onClick={() => mutation.mutate(password)}
              disabled={mutation.isPending || password.length < 8}
              className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground rounded-lg transition-colors"
            >
              {mutation.isPending ? "שומר..." : "הגדר סיסמה"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Delete Confirm Dialog ─────────────────────────────────────────── */

function DeleteConfirmDialog({ user, onClose, onDeleted, authedFetch }: {
  user: AppUser; onClose: () => void; onDeleted: () => void;
  authedFetch: ReturnType<typeof useAuthedFetch>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError]       = useState("");

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      await authedFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError((err as Error).message ?? "שגיאה");
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div dir="rtl" className="bg-card rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">מחיקת משתמש</h2>
          <button onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-muted-foreground">
            האם למחוק את המשתמש{" "}
            <span className="font-semibold text-foreground">{user.full_name ?? user.email}</span>?
            פעולה זו היא מחיקה רכה — הנתונים נשמרים אך המשתמש לא יוצג יותר.
          </p>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 mt-3">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            ביטול
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium bg-destructive hover:bg-destructive/90 disabled:opacity-60 text-destructive-foreground rounded-lg transition-colors"
          >
            {deleting ? "מוחק..." : "מחק משתמש"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Settings Page ────────────────────────────────────────────── */

type DialogMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; user: AppUser }
  | { kind: "password"; user: AppUser }
  | { kind: "delete"; user: AppUser };

export default function Settings() {
  const authedFetch = useAuthedFetch();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<DialogMode>({ kind: "none" });

  const { data: users, isLoading, error } = useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: () => authedFetch("/api/users"),
  });

  const closeDialog = () => setDialog({ kind: "none" });

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    closeDialog();
  };

  const onDeleted = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    closeDialog();
  };

  return (
    <Shell title="הגדרות">
      <div className="p-6 space-y-6 overflow-auto h-full">

        {/* Quick links */}
        <section>
          <h2 className="text-base font-semibold text-foreground/80 mb-3">הגדרות מערכת</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Link href="/settings/quote-pdf-template">
              <a className="flex items-center gap-3 bg-card border border-border hover:border-blue-400 hover:shadow-sm rounded-xl p-4 transition-all cursor-pointer group">
                <div className="w-10 h-10 rounded-lg bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">טמפלט הצעת מחיר</div>
                  <div className="text-xs text-muted-foreground">עיצוב ותוכן PDF</div>
                </div>
              </a>
            </Link>
            <Link href="/settings/monday">
              <a className="flex items-center gap-3 bg-card border border-border hover:border-indigo-400 hover:shadow-sm rounded-xl p-4 transition-all cursor-pointer group">
                <div className="w-10 h-10 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
                  <RefreshCw className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">סנכרון Monday</div>
                  <div className="text-xs text-muted-foreground">יעדים, מיפויים וריצות</div>
                </div>
              </a>
            </Link>
            <Link href="/settings/vat-audit">
              <a className="flex items-center gap-3 bg-card border border-border hover:border-amber-400 hover:shadow-sm rounded-xl p-4 transition-all cursor-pointer group">
                <div className="w-10 h-10 rounded-lg bg-amber-50 group-hover:bg-amber-100 flex items-center justify-center transition-colors">
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">ביקורת מיגרציית מע״מ</div>
                  <div className="text-xs text-muted-foreground">בדיקת עסקאות לאחר המיגרציה</div>
                </div>
              </a>
            </Link>
          </div>
        </section>

        {/* Users section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-foreground/80">ניהול משתמשים</h2>
            <button
              onClick={() => setDialog({ kind: "create" })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              הוסף משתמש
            </button>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">טוען משתמשים...</p>}
          {error && <p className="text-sm text-destructive">שגיאה בטעינת המשתמשים.</p>}

          {users && (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">אימייל</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">טלפון</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">תפקיד</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">סטטוס</th>
                    <th className="px-4 py-3 w-32" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{u.full_name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{u.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.role ? (ROLE_LABELS[u.role] ?? u.role) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                        }`}>
                          {u.is_active ? "פעיל" : "לא פעיל"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setDialog({ kind: "password", user: u })}
                            title="הגדר סיסמה"
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDialog({ kind: "edit", user: u })}
                            title="עריכה"
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDialog({ kind: "delete", user: u })}
                            title="מחיקה"
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Version */}
        <p className="text-xs text-muted-foreground/40 text-center pb-2">
          גרסה {versionInfo.version} · בנייה {versionInfo.build} · {versionInfo.builtAt}
        </p>
      </div>

      {/* Dialogs */}
      {dialog.kind === "create" && (
        <UserFormDialog authedFetch={authedFetch} onClose={closeDialog} onSaved={onSaved} />
      )}
      {dialog.kind === "edit" && (
        <UserFormDialog user={dialog.user} authedFetch={authedFetch} onClose={closeDialog} onSaved={onSaved} />
      )}
      {dialog.kind === "password" && (
        <SetPasswordDialog user={dialog.user} authedFetch={authedFetch} onClose={closeDialog} />
      )}
      {dialog.kind === "delete" && (
        <DeleteConfirmDialog user={dialog.user} authedFetch={authedFetch} onClose={closeDialog} onDeleted={onDeleted} />
      )}
    </Shell>
  );
}
