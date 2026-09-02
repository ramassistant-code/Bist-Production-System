import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const MAX_INQUIRIES = 2_000;

// ⚠️ להעלות בכל שינוי בלוגיקת ההתאמה או הזיהוי.
// שני סבבי אבחון שלמים אבדו על השאלה "האם הגרסה שרצה מכילה את התיקון",
// שאי אפשר היה לענות עליה מבחוץ. התשובה מחזירה את הערך הזה, ואת רגע
// עליית התהליך — פריסה חדשה מאפסת אותו.
const REBUILD_ALGORITHM = "identity-by-value-v2";
const PROCESS_STARTED_AT = new Date().toISOString();
const LEAD_FIELD_NAMES = new Set([
  "full_name",
  "first_name",
  "last_name",
  "phone",
  "phone_number",
  "email",
]);

type RebuildQuestion = {
  label: string | null;
  options: Map<string, string>;
};

type FieldDataEntry = {
  name?: unknown;
  values?: unknown;
};

type InquiryRow = {
  id: string;
  free_text: string | null;
  raw_payload: unknown;
  lead_name: string | null;
  lead_phone_e164: string | null;
  lead_phone_raw: string | null;
  lead_email: string | null;
};

// ערכי הזהות של הליד, לצורך זיהוי שדות זהות בטופס
type LeadIdentity = {
  names: Set<string>;
  emails: Set<string>;
  phoneDigits: Set<string>;
};

export type RebuildFreeTextReport = {
  service: {
    rebuild_algorithm: string;
    started_at: string;
  };
  form_id: string;
  dry_run: boolean;
  examined: number;
  rebuilt: number;
  unchanged: number;
  skipped: number;
  // כמה שורות הוחרגו כשדות זהות. אפס על טופס עם מפתחות מותאמים לשם,
  // טלפון או דוא"ל פירושו שהזיהוי לא תפס — בלי זה אי אפשר לראות את זה
  // מבחוץ אלא דרך תוכן ה-samples, שמכיל פרטים אמיתיים.
  identity_lines_excluded: number;
  samples: Array<{
    inquiry_id: string;
    before: string | null;
    after: string;
  }>;
};

export class RebuildFreeTextError extends Error {}

function questionMap(value: unknown): Map<string, RebuildQuestion> {
  const result = new Map<string, RebuildQuestion>();
  if (!Array.isArray(value)) return result;

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const key = typeof record["key"] === "string" ? record["key"] : "";
    if (!key) continue;

    const options = new Map<string, string>();
    if (Array.isArray(record["options"])) {
      for (const option of record["options"]) {
        if (!option || typeof option !== "object" || Array.isArray(option)) {
          continue;
        }
        const optionRecord = option as Record<string, unknown>;
        if (
          typeof optionRecord["key"] === "string" &&
          typeof optionRecord["value"] === "string"
        ) {
          options.set(optionRecord["key"], optionRecord["value"]);
        }
      }
    }

    result.set(key, {
      label:
        typeof record["label"] === "string" && record["label"]
          ? record["label"]
          : null,
      options,
    });
  }

  return result;
}

function fieldData(rawPayload: unknown): FieldDataEntry[] | null {
  if (
    !rawPayload ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return null;
  }
  const value = (rawPayload as Record<string, unknown>)["field_data"];
  if (!Array.isArray(value)) return null;
  return value.filter(
    (entry): entry is FieldDataEntry =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

function leadIdentity(inquiry: InquiryRow): LeadIdentity {
  const names = new Set<string>();
  const emails = new Set<string>();
  const phoneDigits = new Set<string>();

  if (inquiry.lead_name) names.add(collapse(inquiry.lead_name));
  if (inquiry.lead_email) emails.add(collapse(inquiry.lead_email));
  for (const phone of [inquiry.lead_phone_e164, inquiry.lead_phone_raw]) {
    const digits = phone ? digitsOf(phone) : "";
    // רק שבע ספרות ומעלה — מספר קצר מדי היה תואם תשובות מספריות תמימות
    if (digits.length >= 7) phoneDigits.add(digits);
  }
  return { names, emails, phoneDigits };
}

// שדה זהות = שדה שהערך שלו כבר שמור כעמודה על הליד.
//
// הרשימה הקנונית של מטא לא מספיקה: שלושה מהטפסים משתמשים במפתחות
// מותאמים בעברית לשם, לטלפון ולדוא"ל, ואז 27 מתוך 38 הפניות היו מקבלות
// "Phone number: ..." בתוך free_text כאילו זו תשובה בטופס.
//
// ההשוואה היא לפי הערך ולא לפי דפוס במפתח. דפוס כמו name|שם היה מוחק
// בשקט שאלה לגיטימית כמו "מה שם העסק שלך?" — וכאן טעות היא מחיקת תוכן,
// לא שדה ריק. השוואת ערך אינה יכולה לטעות כך.
function isIdentityValue(values: string[], identity: LeadIdentity): boolean {
  return values.some((value) => {
    const text = collapse(value);
    if (!text) return false;
    if (identity.names.has(text) || identity.emails.has(text)) return true;
    const digits = digitsOf(value);
    if (digits.length >= 7) {
      for (const known of identity.phoneDigits) {
        // מטא מחזירה לעתים 0501234567 ולעתים +972501234567
        if (known.endsWith(digits) || digits.endsWith(known)) return true;
      }
    }
    return false;
  });
}

function rebuildEntry(
  entry: FieldDataEntry,
  questions: Map<string, RebuildQuestion>,
  identity: LeadIdentity,
): string | null {
  if (typeof entry.name !== "string" || LEAD_FIELD_NAMES.has(entry.name)) {
    return null;
  }
  if (!Array.isArray(entry.values) || entry.values.length === 0) return null;

  const question = questions.get(entry.name);
  const questionText = question?.label ?? entry.name;
  const values = entry.values.filter(
    (value): value is string => typeof value === "string",
  );
  if (values.length === 0) return null;

  // מפתח מותאם שערכו הוא שם, טלפון או דוא"ל של הליד — שדה זהות, לא שאלה
  if (isIdentityValue(values, identity)) return null;

  const answers = values.map((value) => question?.options.get(value) ?? value);
  return `${questionText}: ${answers.join(", ")}`;
}

function rebuiltText(
  rawPayload: unknown,
  questions: Map<string, RebuildQuestion>,
  identity: LeadIdentity,
): { text: string; identityExcluded: number } {
  const entries = fieldData(rawPayload);
  if (!entries) return { text: "", identityExcluded: 0 };

  let identityExcluded = 0;
  const lines: string[] = [];
  for (const entry of entries) {
    // הבחנה בין "הוחרג כשדה זהות" לבין "אין ממנו מה לבנות": רק הראשון
    // מעיד שהזיהוי עבד, וזה מה שאי אפשר היה לראות מבחוץ בלי לשלוף samples
    // שמכילים פרטים אמיתיים.
    const values =
      Array.isArray(entry.values)
        ? entry.values.filter((v): v is string => typeof v === "string")
        : [];
    if (
      typeof entry.name === "string" &&
      !LEAD_FIELD_NAMES.has(entry.name) &&
      values.length > 0 &&
      isIdentityValue(values, identity)
    ) {
      identityExcluded += 1;
      continue;
    }
    const line = rebuildEntry(entry, questions, identity);
    if (line !== null) lines.push(line);
  }
  return { text: lines.join("\n"), identityExcluded };
}
function json(value: unknown): string {
  return JSON.stringify(value);
}

export async function rebuildFreeText(
  formId: string,
  questionsInput: unknown,
  dryRun: boolean,
): Promise<RebuildFreeTextReport> {
  const questions = questionMap(questionsInput);

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${"crm-rebuild-free-text:" + formId}, 0)
      )
    `);

    const inquiryResult = await tx.execute(sql`
      select i.id,
             i.free_text,
             i.raw_payload,
             l.name       as lead_name,
             l.phone_e164 as lead_phone_e164,
             l.phone_raw  as lead_phone_raw,
             l.email      as lead_email
      from crm_inquiries i
      join crm_leads l on l.id = i.lead_id
      where i.form_id = ${formId}
      order by i.id
      limit ${MAX_INQUIRIES + 1}
      for update of i
    `);
    const inquiries = inquiryResult.rows as InquiryRow[];

    if (inquiries.length > MAX_INQUIRIES) {
      throw new RebuildFreeTextError(
        `הטופס מכיל יותר מ-${MAX_INQUIRIES} פניות`,
      );
    }

    const report: RebuildFreeTextReport = {
      service: {
        rebuild_algorithm: REBUILD_ALGORITHM,
        started_at: PROCESS_STARTED_AT,
      },
      form_id: formId,
      dry_run: dryRun,
      examined: inquiries.length,
      rebuilt: 0,
      unchanged: 0,
      skipped: 0,
      identity_lines_excluded: 0,
      samples: [],
    };

    for (const inquiry of inquiries) {
      const before = inquiry.free_text;
      const rebuild = rebuiltText(
        inquiry.raw_payload,
        questions,
        leadIdentity(inquiry),
      );
      const after = rebuild.text;
      report.identity_lines_excluded += rebuild.identityExcluded;

      if (!after.trim()) {
        report.skipped += 1;
        continue;
      }
      if (before === after) {
        report.unchanged += 1;
        continue;
      }

      report.rebuilt += 1;
      if (report.samples.length < 5) {
        report.samples.push({
          inquiry_id: inquiry.id,
          before,
          after,
        });
      }

      if (dryRun) continue;

      await tx.execute(sql`
        update crm_inquiries
        set free_text = ${after}
        where id = ${inquiry.id}::uuid
      `);

      await tx.execute(sql`
        insert into crm_audit_log (
          entity_type, entity_id, action, actor_user_id, details
        )
        values (
          'crm_inquiry',
          ${inquiry.id}::uuid,
          'free_text_rebuilt',
          null,
          ${json({
            form_id: formId,
            previous_text: before,
            new_text: after,
          })}::jsonb
        )
      `);
    }

    return report;
  });
}