import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmAuditLogTable,
  crmLeadStatusesTable,
  crmLeadTasksTable,
  crmLeadsTable,
  crmRejectionReasonsTable,
} from "@workspace/db/schema";

export type StatusChangeTask = {
  title: string;
  due_at: string | Date;
};

export type StatusChangeRejection = {
  rejection_reason_code?: string | null;
  rejection_detail?: string | null;
};

export class StatusChangeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

function invalidStatus(): never {
  throw new StatusChangeError("סטטוס הליד אינו תקין");
}

function parseFutureDate(value: string | Date): Date {
  const dueAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dueAt.getTime())) {
    throw new StatusChangeError("חובה ליצור משימה עם תאריך");
  }
  if (dueAt.getTime() <= Date.now()) {
    throw new StatusChangeError("לא ניתן להזין תאריך שעבר");
  }
  return dueAt;
}

export async function applyStatusChange({
  leadId,
  toStatus,
  actorId,
  task,
  rejection,
}: {
  leadId: string;
  toStatus: string;
  actorId: string;
  task?: StatusChangeTask;
  rejection?: StatusChangeRejection;
}) {
  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(crmLeadsTable)
      .where(and(eq(crmLeadsTable.id, leadId), isNull(crmLeadsTable.deleted_at)))
      .limit(1);

    if (!lead) {
      throw new StatusChangeError("ליד לא נמצא", 404);
    }

    const [status] = await tx
      .select({ code: crmLeadStatusesTable.code })
      .from(crmLeadStatusesTable)
      .where(
        and(
          eq(crmLeadStatusesTable.code, toStatus),
          eq(crmLeadStatusesTable.is_active, true),
        ),
      )
      .limit(1);

    if (!status) invalidStatus();

    if (toStatus === "paid") {
      throw new StatusChangeError("סטטוס זה מתעדכן אוטומטית בעת קליטת תשלום");
    }
    if (toStatus === "new") {
      throw new StatusChangeError("לא ניתן להחזיר ליד לסטטוס חדש");
    }

    let statusTask: { title: string; due_at: Date } | null = null;
    if (toStatus === "pipe" || toStatus === "long_followup") {
      const title = task?.title?.trim();
      if (!title || !task?.due_at) {
        throw new StatusChangeError("חובה ליצור משימה עם תאריך");
      }
      statusTask = { title, due_at: parseFutureDate(task.due_at) };
    }

    let rejectionReasonCode: string | null = null;
    let rejectionDetail: string | null = null;
    if (toStatus === "not_relevant") {
      rejectionReasonCode = rejection?.rejection_reason_code?.trim() || null;
      if (!rejectionReasonCode) {
        throw new StatusChangeError("חובה לבחור סיבת דחייה");
      }

      const [reason] = await tx
        .select({
          code: crmRejectionReasonsTable.code,
          requires_detail: crmRejectionReasonsTable.requires_detail,
        })
        .from(crmRejectionReasonsTable)
        .where(
          and(
            eq(crmRejectionReasonsTable.code, rejectionReasonCode),
            eq(crmRejectionReasonsTable.is_active, true),
          ),
        )
        .limit(1);

      if (!reason) {
        throw new StatusChangeError("סיבת הדחייה אינה תקינה");
      }

      rejectionDetail = rejection?.rejection_detail?.trim() || null;
      if (reason.requires_detail && !rejectionDetail) {
        throw new StatusChangeError("חובה להוסיף פירוט לסיבת הדחייה");
      }
    }

    // Wave 4 RoundRobin must exclude leads whose status code is wrong_number.
    const [updatedLead] = await tx
      .update(crmLeadsTable)
      .set({
        status_code: toStatus,
        updated_at: new Date(),
        // יוצאים מ"לא רלוונטי" — הסיבה והפירוט מתארים דחייה שכבר לא קיימת.
        // בלי הניקוי הזה הכרטיס ימשיך להציג סיבת דחייה על ליד פעיל.
        rejection_reason_code:
          toStatus === "not_relevant" ? rejectionReasonCode : null,
        rejection_detail:
          toStatus === "not_relevant" ? rejectionDetail : null,
      })
      .where(eq(crmLeadsTable.id, leadId))
      .returning();

    if (statusTask) {
      await tx.insert(crmLeadTasksTable).values({
        lead_id: leadId,
        // ליד לא משויך עדיין מחייב מעקב. משימה עם assigned_user_id ריק לא
        // תופיע אצל אף אחד ב-tasks/mine, כלומר החסימה תיראה כאילו עבדה
        // ולא ייצא ממנה כלום. מי שביצע את המעבר אחראי עליה.
        assigned_user_id: lead.sales_rep_id ?? actorId,
        title: statusTask.title,
        due_at: statusTask.due_at,
        source: "status_auto",
      });
    }

    await tx.insert(crmAuditLogTable).values({
      entity_type: "crm_lead",
      entity_id: leadId,
      action: "status_changed",
      actor_user_id: actorId,
      details: {
        from: lead.status_code,
        to: toStatus,
        ...(rejectionReasonCode
          ? { rejection_reason_code: rejectionReasonCode }
          : {}),
      },
    });

    return updatedLead;
  });
}