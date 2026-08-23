import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  is_active: boolean;
  phone?: string | null;
}

interface AuthContextValue {
  session: Session | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAppUser(token: string): Promise<AppUser | null> {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session ?? null;
      setSession(s);
      if (s) {
        const u = await fetchAppUser(s.access_token);
        if (!u) {
          await supabase.auth.signOut();
          setSession(null);
        } else {
          setAppUser(u);
        }
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        setSession(s);
        if (s) {
          const u = await fetchAppUser(s.access_token);
          setAppUser(u);
        } else {
          setAppUser(null);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async (
    email: string,
    password: string
  ): Promise<{ error: string | null }> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) {
      return { error: "אימייל או סיסמה שגויים" };
    }

    const u = await fetchAppUser(data.session.access_token);
    if (!u) {
      await supabase.auth.signOut();
      return {
        error:
          "האימייל הזה אינו רשום כמשתמש פעיל במערכת. פנה למנהל המערכת.",
      };
    }

    setAppUser(u);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAppUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
