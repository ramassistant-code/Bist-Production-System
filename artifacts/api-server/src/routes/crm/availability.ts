import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  appUsersTable,
  crmAuditLogTable,
  crmRepAvailabilityTable,
} from "@workspace/db/schema";
import { requireRole } from "../../middlewares/require-auth";

const router: IRouter = Router();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use("/availability", requireRole("sales_manager", "admin"));

router.get(
  "/availability",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await db.execute(sql`
        with next_user as (
          select a.user_id
          from crm_rep_availability a
          join app_users active_user on active_user.id = a.user_id
          where a.is_active_today = true
            and active_user.is_active = true
            and active_user.deleted_at is null
          order by a.last_assigned_at nulls first, a.queue_position, a.user_id
          limit 1
        )
        select
          u.id,
          u.full_name,
          u.email,
          u.phone,
          u.role::text as role,
          u.is_active,
          coalesce(a.is_active_today, false) as is_active_today,
          case
            when a.leads_today_date = current_date then a.leads_today
            else 0
          end::int as leads_today,
          coalesce(a.queue_position, 0)::int as queue_position,
          a.last_assigned_at,
          (u.id = (select user_id from next_user)) as is_next_in_queue
        from app_users u
        left join crm_rep_availability a on a.user_id = u.id
        where u.deleted_at is null
          and u.role::text in ('sales', 'sales_manager', 'admin')
        order by
          case u.role::text
            when 'sales' then 0
            when 'sales_manager' then 1
            else 2
          end,
          coalesce(a.queue_position, 0),
          u.full_name nulls last,
          u.email
      `);
      res.json(result.rows);
    } catch (err) {
      req.log.error({ err }, "Failed to list CRM availability");
      res.status(500).json({ error: "שגיאה בטעינת זמינות אנשי המכירות" });
    }
  },
);

router.patch(
  "/availability/:userId",
  async (req: Request, res: Response): Promise<void> => {
    const userIdValue = req.params["userId"];
    const userId = Array.isArray(userIdValue) ? userIdValue[0] : userIdValue;
    const isActiveToday =
      req.body &&
      typeof req.body === "object" &&
      !Array.isArray(req.body) &&
      typeof req.body.is_active_today === "boolean"
        ? req.body.is_active_today
        : null;

    if (!userId || !UUID_PATTERN.test(userId) || isActiveToday === null) {
      res.status(400).json({ error: "עדכון הזמינות אינו תקין" });
      return;
    }
    if (userId === req.appUser!.id) {
      res.status(403).json({ error: "לא ניתן לשנות את הזמינות של עצמך" });
      return;
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [target] = await tx
          .select({
            id: appUsersTable.id,
            role: appUsersTable.role,
          })
          .from(appUsersTable)
          .where(
            and(
              eq(appUsersTable.id, userId),
              isNull(appUsersTable.deleted_at),
              sql`${appUsersTable.role}::text in ('sales', 'sales_manager', 'admin')`,
            ),
          )
          .limit(1);
        if (!target) return null;

        const [before] = await tx
          .select()
          .from(crmRepAvailabilityTable)
          .where(eq(crmRepAvailabilityTable.user_id, userId))
          .limit(1);

        const [availability] = await tx
          .insert(crmRepAvailabilityTable)
          .values({
            user_id: userId,
            is_active_today: isActiveToday,
            updated_by: req.appUser!.id,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: crmRepAvailabilityTable.user_id,
            set: {
              is_active_today: isActiveToday,
              updated_by: req.appUser!.id,
              updated_at: new Date(),
            },
          })
          .returning();

        await tx.insert(crmAuditLogTable).values({
          entity_type: "crm_rep_availability",
          entity_id: userId,
          action: "availability_toggled",
          actor_user_id: req.appUser!.id,
          details: {
            target_user_id: userId,
            before: {
              is_active_today: before?.is_active_today ?? false,
            },
            after: {
              is_active_today: availability.is_active_today,
            },
          },
        });

        return {
          ...availability,
          leads_today:
            availability.leads_today_date ===
            new Date().toISOString().slice(0, 10)
              ? availability.leads_today
              : 0,
          role: target.role,
        };
      });

      if (!updated) {
        res.status(404).json({ error: "משתמש מכירות לא נמצא" });
        return;
      }
      res.json(updated);
    } catch (err) {
      req.log.error({ err, userId }, "Failed to update CRM availability");
      res.status(500).json({ error: "שגיאה בעדכון הזמינות" });
    }
  },
);

export default router;
