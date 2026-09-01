const ROLE_VALUE_BY_LABEL: Record<string, string> = {
  "מנהל": "admin",
  "מכירות": "sales",
  "מנהל מכירות": "sales_manager",
  "מנהל סטודיו": "studio_manager",
  "עורך": "editor",
  "מנהל משרד": "office_manager",
  "מנהל עריכה": "editing_manager",
};

export const VALID_APP_ROLES = new Set([
  "admin",
  "sales",
  "sales_manager",
  "studio_manager",
  "editor",
  "office_manager",
  "editing_manager",
]);

export function normalizeAppRole(
  role: string | null | undefined,
): string | null {
  const value = role?.trim() ?? "";
  if (!value) return null;
  return ROLE_VALUE_BY_LABEL[value] ?? value.toLowerCase();
}

export function isValidAppRole(role: string | null): boolean {
  return role === null || VALID_APP_ROLES.has(role);
}