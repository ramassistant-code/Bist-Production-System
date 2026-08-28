export function crmEmpty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

export function crmDate(value: unknown, includeTime = false): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return crmEmpty(value);
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
  }).format(date);
}

export function crmCurrency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(number)) return crmEmpty(value);
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(number);
}

export function crmNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}