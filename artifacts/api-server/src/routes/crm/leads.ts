import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  crmAdsTable,
  crmCallLogsTable,
  crmFunnelsTable,
  crmInquiriesTable,
  crmLeadNotesTable,
  crmLeadTasksTable,
  crmLeadsTable,
  insertCrmLeadSchema,
  updateCrmLeadSchema,
} from "@workspace/db/schema";
import { crmLeadView, leadScope } from "../../services/crm/scope";
import { dealsForCustomer, productsForCustomer } from "../../services/crm/legacy-read";
import { toE164 } from "../../services/crm/phone";

const router: IRouter = Router();

const inquirySummary = db
  .select({
    lead_id: crmInquiriesTable.lead_id,
    funnel_id: sql<string | null>`(array_agg(${crmInquiriesTable.funnel_id} ORDER BY ${crmInquiriesTable.inquiry_at} DESC))[1]`.as("funnel_id"),
    last_inquiry_at: sql<Date | null>`max(${crmInquiriesTable.inquiry_at})`.as("last_inquiry_at"),
    inquiry_count: sql<number>`count(*)::int`.as("inquiry_count"),
  })
  .from(crmInquiriesTable)
  .groupBy(crmInquiriesTable.lead_id)
  .as("crm_inquiry_summary");

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(Math.floor(parsed), max));
}

function leadId(req: Request): string | null {
  const value = req.params["id"];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function leadInput(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function normalizedLeadPayload(body: Record<string, unknown>) {
  const rawPhone = body["phone"];
  if (typeof rawPhone !== "string") return null;

  const phone_e164 = toE164(rawPhone);
  if (!phone_e164) return null;

  return {
    name: body["name"],
    phone_e164,
    phone_raw: rawPhone,
    email: body["email"],
    answer_status: body["answer_status"],
    rejection_reason_code: body["rejection_reason_code"],
    rejection_detail: body["rejection_detail"],
    source_ref: body["source_ref"],
  };
}

router.get("/leads", async (req: Request, res: Response): Promise<void> => {
  const view = crmLeadView(req.query["view"]);
  const search = queryString(req, "search");
  const status = queryString(req, "status");
  const salesRepId = queryString(req, "sales_rep");
  const funnelId = queryString(req, "funnel");
  const limit = Math.max(1, boundedInteger(req.query["limit"], 100, 500));
  const offset = boundedInteger(req.query["offset"], 0, Number.MAX_SAFE_INTEGER);
  const conditions = [isNull(crmLeadsTable.deleted_at), leadScope(req, view)];

  if (search) {
    conditions.push(
      or(
        ilike(crmLeadsTable.name, `%${search}%`),
        ilike(crmLeadsTable.phone_e164, `%${search}%`),
        ilike(crmLeadsTable.phone_raw, `%${search}%`),
        ilike(crmLeadsTable.email, `%${search}%`),
      )!,
    );
  }
  if (status) conditions.push(eq(crmLeadsTable.status_code, status));
  if (salesRepId) conditions.push(eq(crmLeadsTable.sales_rep_id, salesRepId));
  if (funnelId) {
    conditions.push(
      inArray(
        crmLeadsTable.id,
        db
          .select({ lead_id: crmInquiriesTable.lead_id })
          .from(crmInquiriesTable)
          .where(eq(crmInquiriesTable.funnel_id, funnelId)),
      ),
    );
  }

  const where = and(...conditions);

  try {
    const [leads, countResult] = await Promise.all([
      db
        .select({
          id: crmLeadsTable.id,
          name: crmLeadsTable.name,
          phone_e164: crmLeadsTable.phone_e164,
          phone_raw: crmLeadsTable.phone_raw,
          email: crmLeadsTable.email,
          sales_rep_id: crmLeadsTable.sales_rep_id,
          status_code: crmLeadsTable.status_code,
          is_active_customer: crmLeadsTable.is_active_customer,
          answer_status: crmLeadsTable.answer_status,
          capture_attempts: crmLeadsTable.capture_attempts,
          rejection_reason_code: crmLeadsTable.rejection_reason_code,
          rejection_detail: crmLeadsTable.rejection_detail,
          pending_reassignment: crmLeadsTable.pending_reassignment,
          legacy_lead_id: crmLeadsTable.legacy_lead_id,
          linked_customer_id: crmLeadsTable.linked_customer_id,
          source: crmLeadsTable.source,
          source_ref: crmLeadsTable.source_ref,
          created_at: crmLeadsTable.created_at,
          updated_at: crmLeadsTable.updated_at,
          deleted_at: crmLeadsTable.deleted_at,
          funnel_id: inquirySummary.funnel_id,
          funnel_name: crmFunnelsTable.name,
          last_inquiry_at: inquirySummary.last_inquiry_at,
          inquiry_count: sql<number>`coalesce(${inquirySummary.inquiry_count}, 0)::int`,
        })
        .from(crmLeadsTable)
        .leftJoin(inquirySummary, eq(crmLeadsTable.id, inquirySummary.lead_id))
        .leftJoin(crmFunnelsTable, eq(inquirySummary.funnel_id, crmFunnelsTable.id))
        .where(where)
        .orderBy(desc(crmLeadsTable.updated_at))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(crmLeadsTable)
        .where(where),
    ]);

    res.setHeader("X-Total-Count", String(countResult[0]?.count ?? 0));
    res.json(leads);
  } catch (err) {
    req.log.error({ err }, "Failed to list CRM leads");
    res.status(500).json({ error: "שגיאה בטעינת הלידים" });
  }
});

router.get("/leads/:id/context", async (req: Request, res: Response): Promise<void> => {
  const id = leadId(req);
  if (!id) {
    res.status(400).json({ error: "מזהה ליד חסר" });
    return;
  }

  try {
    const [lead] = await db
      .select()
      .from(crmLeadsTable)
      .where(
        and(
          eq(crmLeadsTable.id, id),
          isNull(crmLeadsTable.deleted_at),
          leadScope(req, crmLeadView(req.query["view"])),
        ),
      )
      .limit(1);

    if (!lead) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }

    const customerId = lead.linked_customer_id;
    const [inquiries, notes, tasks, callLogs, deals, products] = await Promise.all([
      db
        .select({
          id: crmInquiriesTable.id,
          lead_id: crmInquiriesTable.lead_id,
          ad_id: crmInquiriesTable.ad_id,
          funnel_id: crmInquiriesTable.funnel_id,
          form_name: crmInquiriesTable.form_name,
          free_text: crmInquiriesTable.free_text,
          inquiry_at: crmInquiriesTable.inquiry_at,
          inquiry_number: crmInquiriesTable.inquiry_number,
          raw_payload: crmInquiriesTable.raw_payload,
          source: crmInquiriesTable.source,
          source_ref: crmInquiriesTable.source_ref,
          created_at: crmInquiriesTable.created_at,
          funnel_name: crmFunnelsTable.name,
          ad_name: crmAdsTable.name,
        })
        .from(crmInquiriesTable)
        .leftJoin(crmFunnelsTable, eq(crmInquiriesTable.funnel_id, crmFunnelsTable.id))
        .leftJoin(crmAdsTable, eq(crmInquiriesTable.ad_id, crmAdsTable.id))
        .where(eq(crmInquiriesTable.lead_id, id))
        .orderBy(desc(crmInquiriesTable.inquiry_at)),
      db
        .select()
        .from(crmLeadNotesTable)
        .where(eq(crmLeadNotesTable.lead_id, id))
        .orderBy(desc(crmLeadNotesTable.created_at)),
      db
        .select()
        .from(crmLeadTasksTable)
        .where(eq(crmLeadTasksTable.lead_id, id))
        .orderBy(asc(crmLeadTasksTable.due_at)),
      db
        .select()
        .from(crmCallLogsTable)
        .where(eq(crmCallLogsTable.lead_id, id))
        .orderBy(desc(crmCallLogsTable.started_at)),
      customerId ? dealsForCustomer(customerId) : Promise.resolve([]),
      customerId ? productsForCustomer(customerId) : Promise.resolve([]),
    ]);

    res.json({
      inquiries,
      notes,
      tasks,
      call_logs: callLogs,
      deals,
      products,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load CRM lead context");
    res.status(500).json({ error: "שגיאה בטעינת פרטי הליד" });
  }
});

router.get("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const id = leadId(req);
  if (!id) {
    res.status(400).json({ error: "מזהה ליד חסר" });
    return;
  }

  try {
    const [lead] = await db
      .select()
      .from(crmLeadsTable)
      .where(
        and(
          eq(crmLeadsTable.id, id),
          isNull(crmLeadsTable.deleted_at),
          leadScope(req, crmLeadView(req.query["view"])),
        ),
      )
      .limit(1);

    if (!lead) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }

    res.json(lead);
  } catch (err) {
    req.log.error({ err }, "Failed to get CRM lead");
    res.status(500).json({ error: "שגיאה בטעינת הליד" });
  }
});

router.post("/leads", async (req: Request, res: Response): Promise<void> => {
  const body = leadInput(req.body);
  const payload = body ? normalizedLeadPayload(body) : null;
  if (!payload) {
    res.status(400).json({ error: "מספר טלפון לא תקין" });
    return;
  }

  const parsed = insertCrmLeadSchema.safeParse(payload);
  if (!parsed.success) {
    res.status(400).json({ error: "פרטי הליד אינם תקינים" });
    return;
  }

  try {
    const [created] = await db
      .insert(crmLeadsTable)
      .values({
        ...parsed.data,
        sales_rep_id: req.appUser!.id,
        source: "manual",
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to create CRM lead");
    res.status(500).json({ error: "שגיאה ביצירת הליד" });
  }
});

router.patch("/leads/:id", async (req: Request, res: Response): Promise<void> => {
  const id = leadId(req);
  const body = leadInput(req.body);
  if (!id || !body) {
    res.status(400).json({ error: "עדכון הליד אינו תקין" });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status_code")) {
    res.status(400).json({ error: "שינוי סטטוס יתווסף בשלב הבא" });
    return;
  }

  const payload = { ...body };
  if (Object.prototype.hasOwnProperty.call(payload, "phone")) {
    const rawPhone = payload["phone"];
    const phoneE164 = typeof rawPhone === "string" ? toE164(rawPhone) : null;
    if (!phoneE164) {
      res.status(400).json({ error: "מספר טלפון לא תקין" });
      return;
    }
    payload["phone_e164"] = phoneE164;
    payload["phone_raw"] = rawPhone;
    delete payload["phone"];
  }

  const parsed = updateCrmLeadSchema.safeParse(payload);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "עדכון הליד אינו תקין" });
    return;
  }

  try {
    const [updated] = await db
      .update(crmLeadsTable)
      .set({ ...parsed.data, updated_at: new Date() })
      .where(
        and(
          eq(crmLeadsTable.id, id),
          isNull(crmLeadsTable.deleted_at),
          leadScope(req, crmLeadView(req.query["view"])),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "ליד לא נמצא" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update CRM lead");
    res.status(500).json({ error: "שגיאה בעדכון הליד" });
  }
});

export default router;