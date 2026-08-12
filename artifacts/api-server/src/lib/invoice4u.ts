// ── Invoice4U clearing client ─────────────────────────────────────────────────
// יוצר לינק תשלום (דף סליקה) דרך Invoice4U + משולם.
//
// endpoint: POST https://api.invoice4u.co.il/Services/ApiService.svc/ProcessApiRequestV2
// אימות:    Invoice4UUserApiKey (GUID) — נשמר כ-Secret בשם INVOICE4U_API_KEY.
// תשובה:    ClearingRedirectUrl — זה הלינק שנשלח ללקוח.
//
// ⚠️ שמות השדות מבוססים על תיעוד ה-Apiary של Invoice4U. לפני מעבר לפרודקשן
//    כדאי לאמת מול חשבון ה-Invoice4U (בעזרת טוקן אמיתי) שהשדות תואמים.

import { logger } from "./logger";

const I4U_ENDPOINT =
  process.env.INVOICE4U_ENDPOINT ??
  "https://api.invoice4u.co.il/Services/ApiService.svc/ProcessApiRequestV2";

const I4U_API_KEY = process.env.INVOICE4U_API_KEY ?? "";

// חברת הסליקה (CreditCardCompanyType). 7 = משולם (Meshulam).
const I4U_CLEARING_COMPANY = Number(process.env.INVOICE4U_CLEARING_COMPANY ?? 7);

// סוג העסקה (Type): 1 = רגיל, 2 = תשלומים, 3 = תשלומים באשראי, 4 = זיכוי.
const CLEARING_TYPE_REGULAR = 1;
const CLEARING_TYPE_INSTALLMENTS = 2;

export interface CreatePaymentLinkInput {
  /** סכום לחיוב (כולל מע"מ), בשקלים. */
  sum: number;
  /** שם הלקוח / המשלם. */
  fullName: string;
  /** אימייל הלקוח (לקבלת מסמך). */
  email?: string | null;
  /** טלפון הלקוח. */
  phone?: string | null;
  /** תיאור/מטרת התשלום שיוצג ללקוח. */
  description?: string | null;
  /** מספר תשלומים (>1 יפעיל סליקת תשלומים). */
  installments?: number | null;
  /** כתובת לחזרה אחרי תשלום מוצלח. */
  returnUrl?: string | null;
  /** מזהה חיצוני לשיוך התשלום (למשל מספר עסקה) — חוזר ב-callback. */
  externalId?: string | null;
}

export interface CreatePaymentLinkResult {
  ok: boolean;
  url?: string;
  /** מזהה הסליקה מצד Invoice4U, אם הוחזר. */
  clearingId?: string;
  error?: string;
  /** התשובה הגולמית — שימושי לדיבוג בזמן אימות מול החשבון. */
  raw?: unknown;
}

export function isInvoice4UConfigured(): boolean {
  return I4U_API_KEY.length > 0;
}

/**
 * יוצר לינק תשלום ומחזיר את ה-URL. לעולם לא זורק — מחזיר { ok:false, error }.
 */
export async function createPaymentLink(
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  if (!isInvoice4UConfigured()) {
    return { ok: false, error: "INVOICE4U_API_KEY לא מוגדר בשרת" };
  }
  if (!(input.sum > 0)) {
    return { ok: false, error: "סכום התשלום חייב להיות גדול מ-0" };
  }

  const installments = input.installments && input.installments > 1 ? input.installments : 1;

  // מבנה הבקשה ל-ProcessApiRequestV2. עטוף ב-"request" כפי שמופיע בתיעוד.
  const requestBody: Record<string, unknown> = {
    request: {
      Invoice4UUserApiKey: I4U_API_KEY,
      Type: installments > 1 ? CLEARING_TYPE_INSTALLMENTS : CLEARING_TYPE_REGULAR,
      CreditCardCompanyType: I4U_CLEARING_COMPANY,
      Sum: input.sum,
      Currency: "ILS",
      FullName: input.fullName,
      Phone: input.phone ?? "",
      Email: input.email ?? "",
      Description: input.description ?? "",
      PaymentsNum: installments,
      ...(input.returnUrl ? { ReturnUrl: input.returnUrl } : {}),
      ...(input.externalId ? { OrderIdClientUsage: input.externalId } : {}),
    },
  };

  try {
    const res = await fetch(I4U_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(requestBody),
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      logger.error({ status: res.status, data }, "invoice4u: HTTP error");
      return { ok: false, error: `Invoice4U החזיר שגיאה (${res.status})`, raw: data };
    }

    // התשובה עשויה להגיע עטופה ב-"d" (פורמט WCF) — מנרמלים.
    const payload = (data as { d?: unknown })?.d ?? data;
    const obj = (payload ?? {}) as Record<string, unknown>;

    const url =
      (obj["ClearingRedirectUrl"] as string | undefined) ??
      (obj["PaymentUrl"] as string | undefined) ??
      undefined;

    // Invoice4U מחזיר את מזהה הסליקה בתוך מערך OpenInfo תחת Key="I4UClearingLogId"
    const openInfo =
      (obj["OpenInfo"] as Array<{ Key: string; Value: string }> | undefined) ?? [];
    const i4uClearingLogId = openInfo.find((x) => x.Key === "I4UClearingLogId")?.Value;

    const clearingId =
      i4uClearingLogId ??
      (obj["ClearingId"] as string | undefined) ??
      (obj["ClearingLogId"] as string | undefined) ??
      undefined;

    // תמיד נרשם לוג של תשובה מוצלחת — עוזר לאמת שמות שדות
    logger.info({ payload }, "invoice4u: createPaymentLink raw response");

    if (!url) {
      logger.error({ payload }, "invoice4u: no payment URL in response");
      return {
        ok: false,
        error: "Invoice4U לא החזיר לינק תשלום (בדוק הגדרת חברת סליקה בחשבון)",
        raw: payload,
      };
    }

    return { ok: true, url, clearingId, raw: payload };
  } catch (err) {
    logger.error({ err }, "invoice4u: request failed");
    return { ok: false, error: "כשל בפנייה ל-Invoice4U" };
  }
}

// ── GetClearingLogById ────────────────────────────────────────────────────────

const I4U_CLEARING_STATUS_ENDPOINT =
  process.env.INVOICE4U_CLEARING_STATUS_ENDPOINT ??
  "https://api.invoice4u.co.il/Services/ApiService.svc/GetClearingLogById";

export interface GetClearingStatusResult {
  isSuccess: boolean;
  amount: number;
  confirmationNumber: string | null;
  raw: unknown;
}

/**
 * בודק את סטטוס הסליקה לפי clearingId. לעולם לא זורק — מחזיר { isSuccess:false } בכישלון.
 */
export async function getClearingStatus(
  clearingId: string,
): Promise<GetClearingStatusResult> {
  if (!isInvoice4UConfigured()) {
    return { isSuccess: false, amount: 0, confirmationNumber: null, raw: null };
  }

  try {
    const body = {
      request: {
        clearingLogId: clearingId,
        token: I4U_API_KEY,
      },
    };

    const res = await fetch(I4U_CLEARING_STATUS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      logger.error({ status: res.status, raw: data }, "invoice4u getClearingStatus: HTTP error");
      return { isSuccess: false, amount: 0, confirmationNumber: null, raw: data };
    }

    // תשובת WCF עשויה להגיע עטופה ב-"d"
    const payload = (data as { d?: unknown })?.d ?? data;
    const obj = (payload ?? {}) as Record<string, unknown>;

    logger.info({ raw: obj }, "invoice4u getClearingStatus: raw response");

    // שדות אפשריים לפי תיעוד Invoice4U
    const isSuccess =
      obj["IsSuccess"] === true ||
      obj["isSuccess"] === true ||
      String(obj["Status"] ?? obj["status"] ?? "").toLowerCase() === "success" ||
      String(obj["TransactionStatus"] ?? "").toLowerCase() === "ok";

    const amount = Number(
      obj["Amount"] ?? obj["amount"] ?? obj["Sum"] ?? obj["sum"] ?? 0,
    );

    const confirmationNumber =
      (obj["ConfirmationNumber"] as string | undefined) ??
      (obj["AuthorizationNumber"] as string | undefined) ??
      (obj["TransactionId"] as string | undefined) ??
      null;

    return { isSuccess, amount, confirmationNumber, raw: obj };
  } catch (err) {
    logger.error({ err }, "invoice4u getClearingStatus: request failed");
    return { isSuccess: false, amount: 0, confirmationNumber: null, raw: null };
  }
}
