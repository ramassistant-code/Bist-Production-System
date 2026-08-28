import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";

export interface User {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  is_active: boolean;
}

function fetchSalesUsers() {
  return apiFetch<User[]>("/api/users").then((users) =>
    users.filter(
      (u) =>
        u.role === "sales" || u.role === "sales_manager" || u.role === "admin",
    ),
  );
}

export function useSalesUsers() {
  return useQuery({
    queryKey: ["/api/users", "sales"],
    queryFn: fetchSalesUsers,
  });
}

export function useActiveSalesUsers() {
  return useQuery({
    queryKey: ["/api/users", "sales"],
    queryFn: fetchSalesUsers,
    select: (users) => users.filter((u) => u.is_active),
  });
}
