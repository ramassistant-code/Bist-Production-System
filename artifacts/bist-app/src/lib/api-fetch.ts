import { supabase } from "./supabase";

export async function apiFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const base = (import.meta.env.BASE_URL as string)?.replace(/\/+$/, "") ?? "";
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = `${base}${path}`;
  const hasBody = options?.body !== undefined;
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(options!.body) } : {}),
  });
  if (!res.ok) {
    let msg = `API ${res.status}: ${url}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
