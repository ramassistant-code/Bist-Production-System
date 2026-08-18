// ── WhatsApp deep-link helpers ────────────────────────────────────────────────
// בונה הודעת תשלום מטמפלט + לינק שפותח את ה-WhatsApp Web של איש המכירות
// עם השיחה של הלקוח וההודעה מוכנה לעריכה ושליחה.

/**
 * מנרמל מספר טלפון ישראלי לפורמט בינלאומי ללא סימנים (למשל 972501234567).
 * מחזיר null אם לא ניתן לזהות מספר תקין.
 */
export function normalizePhoneIL(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // הסרת קידומת חיוג בינלאומי 00
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("972")) {
    // כבר בפורמט בינלאומי
  } else if (digits.startsWith("0")) {
    digits = "972" + digits.slice(1);
  } else if (digits.length === 9) {
    // מספר נייד/קווי בלי 0 מוביל
    digits = "972" + digits;
  } else {
    // לא מזהים פורמט מוכר — מחזירים כמו שהוא (ספרות בלבד)
  }

  // מספר ישראלי תקין: 972 + 8-9 ספרות
  if (digits.startsWith("972") && (digits.length === 11 || digits.length === 12)) {
    return digits;
  }
  return digits.length >= 10 ? digits : null;
}

export interface PaymentMessageInput {
  customerName: string;
  /** לינק לתשלום באשראי (דינמי מ-Invoice4U). */
  paymentUrl: string;
  /** לינק לחתימה על הצעת המחיר (deal.quote_link). ריק → placeholder לעריכה. */
  quoteLink?: string | null;
}

// placeholders בסוגריים מרובעים — בולטים וקלים למצוא/להחליף לפני שליחה.
const PH_QUOTE = "[הדבק כאן לינק לחתימה על ההצעה]";
const PH_BANK = "[הדבק כאן לינק להעברה בנקאית]";
const PH_AFTER = "[כתוב כאן מה קורה לאחר החתימה — לפי מה שהלקוח קנה]";

/**
 * בונה את טקסט הודעת התשלום מהטמפלט של BIST.
 * חלקים דינמיים: שם הלקוח, לינק ההצעה, לינק האשראי.
 * חלקים ידניים (placeholders): לינק העברה בנקאית, מה קורה אחרי החתימה.
 */
export function buildPaymentMessage(input: PaymentMessageInput): string {
  const quote = input.quoteLink?.trim() || PH_QUOTE;
  return [
    `היי ${input.customerName} שמחתי להכיר :)`,
    ``,
    `שולח מסודר את השלבים להתקדמות:`,
    `1. חתימה על הצעת מחיר`,
    quote,
    ``,
    `2. תשלום באשראי דרך הלינק הבא:`,
    input.paymentUrl,
    ``,
    `או דרך הלינק הבא בהעברה בנקאית:`,
    PH_BANK,
    ``,
    `שעות הפעילות שלנו:`,
    `א׳ - ה׳: 9:00 - 23:00`,
    `ו׳: 9:00 - שעתיים לפני שבת`,
    `ש׳: שעתיים אחרי שבת - 00:00`,
    ``,
    `* יש חניה באזור`,
    ``,
    `הכתובת שלנו: אליעזר מזל 4 ראשל״צ`,
    ``,
    PH_AFTER,
    ``,
    `כאן לכל שאלה נוספת🙏🏻`,
  ].join("\n");
}

export interface OnboardingMessageInput {
  customerName: string;
  /** לינק לעמוד החתימה הציבורי (מציג את ה-PDF + אישור). */
  signingUrl: string;
  /** לינק לתשלום באשראי (דינמי מ-Invoice4U, על הסכום כולל מע"מ). */
  paymentUrl: string;
}

/**
 * טמפלט ה-onboarding ממסך הצעת המחיר: שלב 1 = חתימה על ה-PDF, שלב 2 = תשלום.
 * (ללא העברה בנקאית / "מה קורה אחרי" — הוסרו לפי הטמפלט העדכני.)
 */
export function buildOnboardingMessage(input: OnboardingMessageInput): string {
  return [
    `היי ${input.customerName} שמחתי להכיר :)`,
    ``,
    `שולח מסודר את השלבים להתקדמות:`,
    `1. חתימה על הצעת מחיר`,
    input.signingUrl,
    ``,
    `2. תשלום באשראי דרך הלינק הבא:`,
    input.paymentUrl,
    ``,
    `שעות הפעילות שלנו:`,
    `א׳ - ה׳: 9:00 - 23:00`,
    `ו׳: 9:00 - שעתיים לפני שבת`,
    `ש׳: שעתיים אחרי שבת - 00:00`,
    ``,
    `* יש חניה באזור`,
    ``,
    `הכתובת שלנו: אליעזר מזל 4 ראשל״צ`,
    ``,
    `כאן לכל שאלה נוספת🙏🏻`,
  ].join("\n");
}

export interface DirectSaleMessageInput {
  customerName: string;
  /** רשימת המוצרים שנרכשו (ללא רכיבים). */
  items: Array<{ name: string; quantity: number }>;
  /** סה"כ לתשלום כולל מע"מ. */
  totalWithVat: number;
  /** לינק לתשלום באשראי. */
  paymentUrl: string;
}

/**
 * הודעת ווטסאפ למכירה ישירה (ללא הצעת מחיר + PDF).
 * מפרטת את המוצרים שנרכשו + סכום לתשלום + לינק לתשלום.
 */
export function buildDirectSaleMessage(input: DirectSaleMessageInput): string {
  const itemLines = input.items.map(
    (it) => `• ${it.name}${it.quantity > 1 ? ` × ${it.quantity}` : ""}`,
  );
  const totalStr = `₪${input.totalWithVat.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    `שלום ${input.customerName}`,
    ``,
    `להלן המוצרים שרכשת:`,
    ...itemLines,
    ``,
    `סה״כ לתשלום: ${totalStr}`,
    `לינק לתשלום:`,
    input.paymentUrl,
  ].join("\n");
}

/**
 * בונה קישור שפותח את WhatsApp Web עם השיחה של הלקוח וההודעה בתיבה.
 * מחזיר null אם אין מספר טלפון תקין.
 */
export function buildWhatsAppLink(phone: string | null | undefined, message: string): string | null {
  const normalized = normalizePhoneIL(phone);
  if (!normalized) return null;
  return `https://web.whatsapp.com/send?phone=${normalized}&text=${encodeURIComponent(message)}`;
}
