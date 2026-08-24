export function digitsOnly(raw: string | null | undefined): string {
  return raw ? String(raw).replace(/\D/g, "") : "";
}

/**
 * Normalizes an Israeli phone number to E.164 for CRM storage.
 */
export function toE164(raw: string | null | undefined): string | null {
  let digits = digitsOnly(raw);
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("972")) {
    // Already in Israeli international format.
  } else if (digits.startsWith("0")) {
    digits = `972${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `972${digits}`;
  } else {
    return null;
  }

  if (!digits.startsWith("972") || (digits.length !== 11 && digits.length !== 12)) {
    return null;
  }

  return `+${digits}`;
}