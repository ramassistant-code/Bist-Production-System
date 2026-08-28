import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";

export interface User {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  is_active: boolean;
}

export function useActiveSalesUsers() {
  return useQuery({
    queryKey: ["/api/users", "sales_active"],
    queryFn: async () => {
      const users = await apiFetch<User[]>("/api/users");
      return users.filter(
        (u) =>
          u.is_active &&
          (u.role === "sales" || u.role === "sales_manager" || u.role === "admin")
      );
    },
  });
}
