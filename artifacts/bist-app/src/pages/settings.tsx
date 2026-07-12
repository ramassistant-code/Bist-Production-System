import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";

interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
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

function SetPasswordDialog({
  user,
  onClose,
}: {
  user: AppUser;
  onClose: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async (pw: string) => {
      return authedFetch(`/api/admin/users/${user.id}/set-password`, {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });
    },
    onSuccess: () => {
      setSuccess(true);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(password);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        dir="rtl"
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4"
      >
        <h2 className="text-lg font-semibold text-gray-900">
          הגדר סיסמה ראשונית
        </h2>
        <p className="text-sm text-gray-600">
          משתמש:{" "}
          <span className="font-medium">
            {user.full_name ?? user.email}
          </span>{" "}
          <span className="text-gray-400">({user.email})</span>
        </p>

        {success ? (
          <div className="space-y-3">
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              הסיסמה הוגדרה בהצלחה.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              סגור
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                סיסמה חדשה
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="לפחות 8 תווים"
                autoFocus
              />
            </div>

            {mutation.isError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {(mutation.error as Error)?.message ?? "שגיאה"}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                ביטול
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || password.length < 8}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors"
              >
                {mutation.isPending ? "שומר..." : "הגדר סיסמה"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const authedFetch = useAuthedFetch();
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  const { data: users, isLoading, error } = useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: () => authedFetch("/api/users"),
  });

  return (
    <Shell title="הגדרות">
      <div className="p-6 space-y-6 overflow-auto h-full">
        <section>
          <h2 className="text-base font-semibold text-gray-800 mb-3">
            ניהול משתמשים
          </h2>

          {isLoading && (
            <p className="text-sm text-gray-500">טוען משתמשים...</p>
          )}

          {error && (
            <p className="text-sm text-red-600">
              שגיאה בטעינת המשתמשים.
            </p>
          )}

          {users && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">
                      שם
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">
                      אימייל
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">
                      תפקיד
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">
                      סטטוס
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {u.full_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {u.role ? (ROLE_LABELS[u.role] ?? u.role) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {u.is_active ? "פעיל" : "לא פעיל"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <button
                          onClick={() => setSelectedUser(u)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        >
                          הגדר סיסמה ראשונית
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selectedUser && (
        <SetPasswordDialog
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </Shell>
  );
}
