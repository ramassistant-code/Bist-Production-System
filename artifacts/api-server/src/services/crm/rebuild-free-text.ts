import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const MAX_INQUIRIES = 2_000;
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
};

export type RebuildFreeTextReport = {
  form_id: string;
  dry_run: boolean;
  examined: number;
  rebuilt: number;
  unchanged: number;
  skipped: number;
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

function rebuildEntry(
  entry: FieldDataEntry,
  questions: Map<string, RebuildQuestion>,
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

  const answers = values.map((value) => question?.options.get(value) ?? value);
  return `${questionText}: ${answers.join(", ")}`;
}

function rebuiltText(
  rawPayload: unknown,
  questions: Map<string, RebuildQuestion>,
): string {
  const entries = fieldData(rawPayload);
  if (!entries) return "";
  return entries
    .map((entry) => rebuildEntry(entry, questions))
    .filter((line): line is string => line !== null)
    .join("\n");
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
      select id, free_text, raw_payload
      from crm_inquiries
      where form_id = ${formId}
      order by id
      limit ${MAX_INQUIRIES + 1}
      for update
    `);
    const inquiries = inquiryResult.rows as InquiryRow[];

    if (inquiries.length > MAX_INQUIRIES) {
      throw new RebuildFreeTextError(
        `הטופס מכיל יותר מ-${MAX_INQUIRIES} פניות`,
      );
    }

    const report: RebuildFreeTextReport = {
      form_id: formId,
      dry_run: dryRun,
      examined: inquiries.length,
      rebuilt: 0,
      unchanged: 0,
      skipped: 0,
      samples: [],
    };

    for (const inquiry of inquiries) {
      const before = inquiry.free_text;
      const after = rebuiltText(inquiry.raw_payload, questions);

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