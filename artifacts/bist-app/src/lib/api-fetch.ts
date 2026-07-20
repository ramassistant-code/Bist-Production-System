import { supabase } from "./supabase";

export async function apiFetch<T>(path: string): Promise<T> {
  const base = (import.meta.env.BASE_URL as string)?.replace(/\/+$/, "") ?? "";
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}
