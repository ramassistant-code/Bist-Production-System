import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { appUsersTable } from "@workspace/db/schema";
import { eq, isNull, and, asc } from "drizzle-orm";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getAuthenticatedUser(req: Request): Promise<{ id: string; email: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

// GET /auth/me — verify JWT and return active app_users row
router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    const [appUser] = await db
      .select()
      .from(appUsersTable)
      .where(
        and(
          eq(appUsersTable.email, authUser.email),
          eq(appUsersTable.is_active, true),
          isNull(appUsersTable.deleted_at)
        )
      )
      .limit(1);

    if (!appUser) {
      res.status(403).json({ error: "אין משתמש פעיל במערכת עם כתובת אימייל זו" });
      return;
    }

    res.json({
      id: appUser.id,
      email: appUser.email,
      full_name: appUser.full_name,
      role: appUser.role,
      is_active: appUser.is_active,
    });
  } catch (err) {
    logger.error({ err }, "Failed to verify auth user");
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// GET /users — list all app_users (requires active session)
router.get("/users", async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    const users = await db
      .select()
      .from(appUsersTable)
      .where(isNull(appUsersTable.deleted_at))
      .orderBy(asc(appUsersTable.full_name));

    res.json(users);
  } catch (err) {
    logger.error({ err }, "Failed to list users");
    res.status(500).json({ error: "שגיאה בטעינת המשתמשים" });
  }
});

// POST /admin/users/:id/set-password — set initial password via Supabase Auth Admin API
router.post(
  "/admin/users/:id/set-password",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) {
        res.status(401).json({ error: "לא מורשה" });
        return;
      }

      const id = String(req.params["id"]);
      const { password } = req.body as { password?: string };

      if (!password || password.length < 8) {
        res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 8 תווים" });
        return;
      }

      const [targetUser] = await db
        .select()
        .from(appUsersTable)
        .where(and(eq(appUsersTable.id, id), isNull(appUsersTable.deleted_at)))
        .limit(1);

      if (!targetUser) {
        res.status(404).json({ error: "משתמש לא נמצא" });
        return;
      }

      const email = targetUser.email;

      const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
      if (listErr) {
        logger.error({ listErr }, "Failed to list auth users");
        res.status(500).json({ error: "שגיאה בגישה לאימות" });
        return;
      }

      const existing = listData.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (existing) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
          password,
        });
        if (error) {
          logger.error({ error }, "Failed to update auth user password");
          res.status(500).json({ error: "שגיאה בעדכון הסיסמה" });
          return;
        }
      } else {
        const { error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error) {
          logger.error({ error }, "Failed to create auth user");
          res.status(500).json({ error: "שגיאה ביצירת משתמש" });
          return;
        }
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to set user password");
      res.status(500).json({ error: "שגיאת שרת" });
    }
  }
);

export default router;
