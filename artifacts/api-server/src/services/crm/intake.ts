import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../../lib/logger";
import { sendCrmNotification } from "../../lib/crm-notify";
import { toE164 } from "./phone";

export type LeadIntakePayload = Record<string, unknown> & {
  source_ref?: unknown;
  name?: unknown;
  phone_raw?: unknown;
  email?: unknown;
  facebook_ad_id?: unknown;
  ad_name?: unknown;
  campaign_id?: unknown;
  campaign_name?: unknown;
  adset_id?: unknown;
  adset_name?: unknown;
  form_id?: unknown;
  form_name?: unknown;
  free_text?: unknown;
  inquiry_at?: unknown;
  raw_payload?: unknown;
};

export type LeadIntakeResult =
  | {
      status: "ingested";
      duplicate: false;
      lead_id: string;
      inquiry_id: string;
      inquiry_number: number;
    }
  | { status: "duplicate"; duplicate: true }
  | { status: "failed"; duplicate: false; stored: boolean };

type IntakeNotification = {
  kind: "assigned" | "repeat";
  leadId: string;
  leadName: string;
  leadPhone: string;
  repPhone: string | null;
  funnelName: string | null;
  adName: string | null;
  adUrl: string | null;
  freeText: string | null;
  isActiveCustomer: boolean;
  inquiryNumber: number;
};

type IntakeLeadRow = {
  id: string;
  name: string;
  phone_e164: string;
  sales_rep_id: string | null;
  status_code: string;
  is_active_customer: boolean;
};

type IntakeAdRow = {
  id: string;
  name: string | null;
  ad_url: string | null;
  funnel_id: string | null;
};

type TransactionResult =
  | { result: LeadIntakeResult; notification: IntakeNotification | null }
  | { result: LeadIntakeResult; notification?: never };

class DuplicateIntakeError extends Error {}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function rawPayload(payload: LeadIntakePayload): unknown {
  return payload.raw_payload ?? payload;
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

function inquiryDate(value: unknown): Date {
  if (typeof value !== "string" && !(value instanceof Date)) return new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
}

function leadLink(leadId: string): string {
  const base = appBaseUrl();
  return base ? `${base}/crm/leads/${leadId}` : `/crm/leads/${leadId}`;
}

function buildNotificationMessage(notification: IntakeNotification): string {
  const link = leadLink(notification.leadId);
  if (notification.kind === "repeat") {
    return [
      `פנייה חוזרת מהליד ${notification.leadName}`,
      notification.leadPhone,
      link,
    ].join("\n");
  }

  const tags = [
    notification.isActiveCustomer ? "לקוח קיים" : null,
    notification.inquiryNumber > 1 ? "השאיר פרטים שוב" : null,
  ].filter(Boolean);

  return [
    `ליד חדש: ${notification.leadName}`,
    `טלפון: ${notification.leadPhone}`,
    `משפך: ${notification.funnelName ?? "לא משויך"}`,
    `מודעה: ${notification.adName ?? "לא ידועה"}`,
    notification.adUrl ? `קישור למודעה: ${notification.adUrl}` : null,
    notification.freeText ? `פרטים: ${notification.freeText}` : null,
    tags.length ? `תגיות: ${tags.join(", ")}` : null,
    `כרטיס ליד: ${link}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function storeFailure(
  payload: LeadIntakePayload,
  source: string,
  error: string,
): Promise<boolean> {
  try {
    await db.execute(sql`
      insert into crm_intake_failures (source, source_ref, raw_payload, error)
      values (
        ${source},
        ${optionalString(payload.source_ref)},
        ${json(rawPayload(payload))}::jsonb,
        ${error}
      )
    `);
    return true;
  } catch (failureError) {
    logger.error(
      { err: failureError, source, sourceRef: optionalString(payload.source_ref) },
      "Failed to persist CRM intake failure",
    );
    return false;
  }
}

export async function ingestLead(
  payload: LeadIntakePayload,
  source: string,
): Promise<LeadIntakeResult> {
  const normalizedSource = source.trim() || "facebook_lead_ads";
  const sourceRef = optionalString(payload.source_ref);
  const phoneRaw = optionalString(payload.phone_raw);
  const phoneE164 = toE164(phoneRaw);

  try {
    const transactionResult = await db.transaction<TransactionResult>(async (tx) => {
      if (sourceRef) {
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${"crm-intake:" + normalizedSource + ":" + sourceRef}, 0)
          )
        `);
        const duplicate = await tx.execute(sql`
          select id
          from crm_inquiries
          where source = ${normalizedSource}
            and source_ref = ${sourceRef}
          limit 1
        `);
        if (duplicate.rows.length > 0) {
          return {
            result: { status: "duplicate", duplicate: true },
          };
        }
      }

      if (!phoneE164) {
        await tx.execute(sql`
          insert into crm_intake_failures (source, source_ref, raw_payload, error)
          values (
            ${normalizedSource},
            ${sourceRef},
            ${json(rawPayload(payload))}::jsonb,
            ${"מספר טלפון לא ניתן לנרמול ל-E.164"}
          )
        `);
        return {
          result: { status: "failed", duplicate: false, stored: true },
        };
      }

      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${"crm-phone:" + phoneE164}, 0))
      `);

      const existingLeadResult = await tx.execute(sql`
        select id, name, phone_e164, sales_rep_id, status_code, is_active_customer
        from crm_leads
        where phone_e164 = ${phoneE164}
          and deleted_at is null
        limit 1
      `);
      let lead = existingLeadResult.rows[0] as IntakeLeadRow | undefined;
      const isNewLead = !lead;

      if (!lead) {
        const insertedLead = await tx.execute(sql`
          insert into crm_leads (
            name, phone_e164, phone_raw, email, status_code, source, source_ref
          )
          values (
            ${optionalString(payload.name) ?? "ליד ללא שם"},
            ${phoneE164},
            ${phoneRaw},
            ${optionalString(payload.email)},
            'new',
            ${normalizedSource},
            ${sourceRef}
          )
          returning id, name, phone_e164, sales_rep_id, status_code, is_active_customer
        `);
        lead = insertedLead.rows[0] as IntakeLeadRow | undefined;
      }
      if (!lead) throw new Error("CRM lead insert returned no row");

      let ad: IntakeAdRow | undefined;
      const facebookAdId = optionalString(payload.facebook_ad_id);
      if (facebookAdId) {
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${"crm-ad:" + facebookAdId}, 0))
        `);
        const knownAd = await tx.execute(sql`
          select id, name, ad_url, funnel_id
          from crm_ads
          where facebook_ad_id = ${facebookAdId}
          limit 1
        `);
        ad = knownAd.rows[0] as typeof ad;

        if (!ad) {
          let inheritedFunnelId: string | null = null;
          const campaignId = optionalString(payload.campaign_id);
          if (campaignId) {
            const inheritedFunnel = await tx.execute(sql`
              select min(funnel_id::text)::uuid as funnel_id
                from crm_ads
               where campaign_id = ${campaignId}
                 and funnel_id is not null
              having count(distinct funnel_id) = 1
            `);
            inheritedFunnelId =
              (inheritedFunnel.rows[0] as { funnel_id?: string } | undefined)
                ?.funnel_id ?? null;
          }

          const insertedAd = await tx.execute(sql`
            insert into crm_ads (
              facebook_ad_id, name, funnel_id, fetch_failed,
              campaign_id, campaign_name, adset_id, adset_name
            )
            values (
              ${facebookAdId},
              ${optionalString(payload.ad_name)},
              ${inheritedFunnelId},
              true,
              ${campaignId},
              ${optionalString(payload.campaign_name)},
              ${optionalString(payload.adset_id)},
              ${optionalString(payload.adset_name)}
            )
            returning id, name, ad_url, funnel_id
          `);
          ad = insertedAd.rows[0] as IntakeAdRow | undefined;
        }
      }

      const insertedInquiry = await tx.execute(sql`
        insert into crm_inquiries (
          lead_id, source, source_ref, form_id, form_name, free_text,
          inquiry_at, raw_payload, ad_id, funnel_id
        )
        values (
          ${lead.id},
          ${normalizedSource},
          ${sourceRef},
          ${optionalString(payload.form_id)},
          ${optionalString(payload.form_name)},
          ${optionalString(payload.free_text)},
          ${inquiryDate(payload.inquiry_at)},
          ${json(rawPayload(payload))}::jsonb,
          ${ad?.id ?? null},
          ${ad?.funnel_id ?? null}
        )
        on conflict (source, source_ref) where source_ref is not null
        do nothing
        returning id, inquiry_number
      `);
      const inquiry = insertedInquiry.rows[0] as
        | { id: string; inquiry_number: number }
        | undefined;
      if (!inquiry) throw new DuplicateIntakeError();

      const reopenedPaid = !isNewLead && lead.status_code === "paid";
      let assignedRepId = lead.sales_rep_id;
      let usedFallback = false;
      let fallbackRole: string | null = null;

      if (isNewLead || reopenedPaid) {
        let keepOriginalRep = false;
        if (reopenedPaid && assignedRepId) {
          const activeOriginal = await tx.execute(sql`
            select 1
            from crm_rep_availability a
            join app_users u on u.id = a.user_id
            where a.user_id = ${assignedRepId}
              and a.is_active_today = true
              and u.is_active = true
              and u.deleted_at is null
            limit 1
          `);
          keepOriginalRep = activeOriginal.rows.length > 0;
        }

        if (!keepOriginalRep) {
          const nextRep = await tx.execute(
            sql`select crm_next_rep_in_queue() as user_id`,
          );
          assignedRepId =
            (nextRep.rows[0] as { user_id?: string | null } | undefined)
              ?.user_id ?? null;

          // crm_next_rep_in_queue() intentionally uses SKIP LOCKED. Under a
          // concurrent burst, every active row can be locked for a few
          // milliseconds; that is not the same as having no active reps.
          if (!assignedRepId) {
            const activeQueue = await tx.execute(sql`
              select 1
              from crm_rep_availability a
              join app_users u on u.id = a.user_id
              where a.is_active_today = true
                and u.is_active = true
                and u.deleted_at is null
              limit 1
            `);
            if (activeQueue.rows.length > 0) {
              for (let attempt = 0; attempt < 12 && !assignedRepId; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                const retriedRep = await tx.execute(
                  sql`select crm_next_rep_in_queue() as user_id`,
                );
                assignedRepId =
                  (
                    retriedRep.rows[0] as
                      | { user_id?: string | null }
                      | undefined
                  )?.user_id ?? null;
              }
            }
          }
        }

        if (!assignedRepId) {
          const fallback = await tx.execute(sql`
            select id, role::text as role
            from app_users
            where is_active = true
              and deleted_at is null
              and role::text in ('sales_manager', 'admin')
            order by case when role::text = 'sales_manager' then 0 else 1 end, id
            limit 1
          `);
          const fallbackUser = fallback.rows[0] as
            | { id: string; role: string }
            | undefined;
          assignedRepId = fallbackUser?.id ?? null;
          fallbackRole = fallbackUser?.role ?? null;
          usedFallback = true;
        }

        const updatedLead = await tx.execute(sql`
          update crm_leads
             set sales_rep_id = ${assignedRepId},
                 status_code = ${reopenedPaid ? "new" : lead.status_code},
                 capture_attempts = ${reopenedPaid ? 0 : sql`capture_attempts`},
                 pending_reassignment = ${assignedRepId ? false : true},
                 updated_at = now()
           where id = ${lead.id}
          returning id, name, phone_e164, sales_rep_id, status_code, is_active_customer
        `);
        lead = updatedLead.rows[0] as IntakeLeadRow | undefined;
        if (!lead) throw new Error("CRM lead assignment returned no row");

        if (usedFallback) {
          await tx.execute(sql`
            insert into crm_audit_log (
              entity_type, entity_id, action, actor_user_id, details
            )
            values (
              'crm_lead',
              ${lead.id},
              'intake_fallback_assignment',
              null,
              ${json({
                reason: "no_active_reps",
                target_user_id: assignedRepId,
                target_role: fallbackRole,
              })}::jsonb
            )
          `);
        }
      }

      let repPhone: string | null = null;
      if (assignedRepId) {
        const receivingRep = await tx.execute(sql`
          select phone
          from app_users
          where id = ${assignedRepId}
          limit 1
        `);
        repPhone =
          (receivingRep.rows[0] as { phone?: string | null } | undefined)?.phone ??
          null;
      }

      let funnelName: string | null = null;
      if (ad?.funnel_id) {
        const funnel = await tx.execute(sql`
          select name from crm_funnels where id = ${ad.funnel_id} limit 1
        `);
        funnelName =
          (funnel.rows[0] as { name?: string | null } | undefined)?.name ?? null;
      }

      return {
        result: {
          status: "ingested",
          duplicate: false,
          lead_id: lead.id,
          inquiry_id: inquiry.id,
          inquiry_number: Number(inquiry.inquiry_number),
        },
        notification: {
          kind: !isNewLead && !reopenedPaid ? "repeat" : "assigned",
          leadId: lead.id,
          leadName: lead.name,
          leadPhone: lead.phone_e164,
          repPhone,
          funnelName,
          adName: ad?.name ?? optionalString(payload.ad_name),
          adUrl: ad?.ad_url ?? null,
          freeText: optionalString(payload.free_text),
          isActiveCustomer: lead.is_active_customer,
          inquiryNumber: Number(inquiry.inquiry_number),
        },
      };
    });

    if (transactionResult.notification) {
      void sendCrmNotification({
        message: buildNotificationMessage(transactionResult.notification),
        phone: transactionResult.notification.repPhone,
      });
    }
    return transactionResult.result;
  } catch (err) {
    if (err instanceof DuplicateIntakeError) {
      return { status: "duplicate", duplicate: true };
    }

    logger.error(
      { err, source: normalizedSource, sourceRef },
      "CRM lead intake transaction failed",
    );
    const stored = await storeFailure(
      payload,
      normalizedSource,
      err instanceof Error ? err.message : "שגיאה לא ידועה בקליטת ליד",
    );
    return { status: "failed", duplicate: false, stored };
  }
}
