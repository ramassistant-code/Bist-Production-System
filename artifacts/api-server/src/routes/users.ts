import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { appUsersTable } from "@workspace/db/schema";
import { eq, isNull, and, asc, sql } from "drizzle-orm";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";
import { sendLoginCodeEmail } from "../lib/email";
import { createHmac, randomInt } from "node:crypto";
import { notifySync } from "../lib/syncClient";
import { getAuthenticatedUser } from "../middlewares/require-auth";

const router: IRouter = Router();

const ROLE_VALUE_BY_LABEL: Record<string, string> = {
  "מנהל": "admin",
  "מכירות": "sales",
  "מנהל סטודיו": "studio_manager",
  "עורך": "editor",
  "מנהל משרד": "office_manager",
  "מנהל עריכה": "editing_manager",
};
const VALID_ROLE_VALUES = new Set(["admin", "sales", "studio_manager", "editor", "office_manager", "editing_manager"]);

function normalizeRole(role: string | null | undefined): string | null {
  const value = role?.trim() ?? "";
  if (!value) return null;
  return ROLE_VALUE_BY_LABEL[value] ?? value;
}

function isValidRole(role: string | null): boolean {
  return role === null || VALID_ROLE_VALUES.has(role);
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

// ── כניסה באמצעות קוד חד-פעמי במייל ─────────────────────────────────────────

// HMAC עם מפתח מחוץ ל-DB — כדי שקוד בן 6 ספרות לא יהיה ניתן לניחוש גם אם הטבלה נחשפת
function hashCode(code: string): string {
  const pepper = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", pepper).update(code).digest("hex");
}

// POST /auth/otp/request — שולח קוד למייל רק אם קיים משתמש מערכת פעיל
router.post("/auth/otp/request", async (req: Request, res: Response): Promise<void> => {
  try {
    const email = String((req.body as { email?: string })?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "כתובת אימייל לא תקינה" });
      return;
    }

    // תשובה אחידה — לא חושפים אם המשתמש קיים או לא
    const genericResponse = { ok: true, message: "אם קיים משתמש עם כתובת זו — נשלח אליו קוד" };

    const [appUser] = await db
      .select()
      .from(appUsersTable)
      .where(
        and(
          eq(appUsersTable.email, email),
          eq(appUsersTable.is_active, true),
          isNull(appUsersTable.deleted_at)
        )
      )
      .limit(1);

    if (!appUser) {
      res.json(genericResponse);
      return;
    }

    // הגבלת קצב: לא יותר מקוד אחד ב-60 שניות
    const recent = await db.execute(sql`
      select 1 from login_codes
      where email = ${email} and created_at > now() - interval '60 seconds'
      limit 1
    `);
    if (recent.rows.length > 0) {
      res.json(genericResponse);
      return;
    }

    const code = String(randomInt(100000, 1000000)); // 6 ספרות
    await db.execute(sql`
      update login_codes set used_at = now() where email = ${email} and used_at is null
    `);
    await db.execute(sql`
      insert into login_codes (email, code_hash, expires_at)
      values (${email}, ${hashCode(code)}, now() + interval '10 minutes')
    `);

    // תשובה אחידה גם אם השליחה נכשלה — כדי לא לחשוף קיום משתמש; הכשל נרשם בלוג
    const sent = await sendLoginCodeEmail(email, code);
    if (!sent) {
      logger.error({ email }, "otp/request: login code email failed to send");
    }

    res.json(genericResponse);
  } catch (err) {
    logger.error({ err }, "POST /auth/otp/request error");
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// POST /auth/otp/verify — מאמת קוד ומחזיר token_hash לכניסה דרך Supabase
router.post("/auth/otp/verify", async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { email?: string; code?: string };
    const email = String(body?.email ?? "").trim().toLowerCase();
    const code = String(body?.code ?? "").trim();

    if (!email || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "קוד לא תקין" });
      return;
    }

    // אימות אטומי: פקודת UPDATE אחת שנועלת את השורה — מונעת ניחוש מקבילי ושימוש כפול.
    // קוד נכון → מסומן כמנוצל; קוד שגוי → attempts עולה. אין מרוץ בין בדיקה לעדכון.
    const codeHash = hashCode(code);
    const claim = await db.execute(sql`
      update login_codes
      set used_at = case when code_hash = ${codeHash} then now() else used_at end,
          attempts = attempts + case when code_hash = ${codeHash} then 0 else 1 end
      where id = (
        select id from login_codes
        where email = ${email} and used_at is null and expires_at > now()
        order by created_at desc limit 1
        for update
      )
        and used_at is null and expires_at > now() and attempts < 5
      returning id, (code_hash = ${codeHash}) as ok, attempts
    `);
    const claimed = claim.rows[0] as { id: string; ok: boolean; attempts: number } | undefined;

    if (!claimed) {
      res.status(400).json({ error: "הקוד פג תוקף או שנוצל — בקש קוד חדש" });
      return;
    }
    if (!claimed.ok) {
      res.status(400).json({
        error: claimed.attempts >= 5 ? "יותר מדי ניסיונות — בקש קוד חדש" : "קוד שגוי",
      });
      return;
    }
    const claimedId = claimed.id;
    // אם שלב ה-Supabase ייכשל — נשחרר את הקוד כדי לאפשר ניסיון חוזר
    const releaseCode = () =>
      db.execute(sql`update login_codes set used_at = null where id = ${claimedId}`).catch(() => {});

    // וידוא שהמשתמש עדיין פעיל
    const [appUser] = await db
      .select()
      .from(appUsersTable)
      .where(
        and(
          eq(appUsersTable.email, email),
          eq(appUsersTable.is_active, true),
          isNull(appUsersTable.deleted_at)
        )
      )
      .limit(1);
    if (!appUser) {
      res.status(403).json({ error: "אין משתמש פעיל במערכת עם כתובת אימייל זו" });
      return;
    }

    // וידוא שקיים משתמש Auth ב-Supabase — ניסיון יצירה ישיר (בטוח גם מעל עמוד אחד של משתמשים);
    // אם המייל כבר רשום — זו לא שגיאה
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr) {
      const msg = createErr.message?.toLowerCase() ?? "";
      const alreadyExists =
        msg.includes("already") || (createErr as { code?: string }).code === "email_exists";
      if (!alreadyExists) {
        logger.error({ createErr }, "otp/verify: failed to create auth user");
        await releaseCode();
        res.status(500).json({ error: "שגיאה ביצירת משתמש — נסה שוב" });
        return;
      }
    }

    // הפקת token_hash שאיתו הקליינט יקבל session מ-Supabase
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      logger.error({ linkErr }, "otp/verify: failed to generate link");
      await releaseCode();
      res.status(500).json({ error: "שגיאה ביצירת כניסה — נסה שוב" });
      return;
    }

    res.json({ ok: true, token_hash: linkData.properties.hashed_token });
  } catch (err) {
    logger.error({ err }, "POST /auth/otp/verify error");
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

// POST /admin/users — create a new app_user
router.post("/admin/users", async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) { res.status(401).json({ error: "לא מורשה" }); return; }

    const { full_name, email, phone, role, is_active } = req.body as {
      full_name?: string; email?: string; phone?: string; role?: string; is_active?: boolean;
    };

    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
    }

    const normalizedRole = normalizeRole(role);
    if (!isValidRole(normalizedRole)) {
      res.status(400).json({ error: "תפקיד משתמש לא תקין" });
      return;
    }

    const [created] = await db.insert(appUsersTable).values({
      id: crypto.randomUUID(),
      full_name: full_name?.trim() || null,
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      role: normalizedRole,
      is_active: is_active !== false,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning();

    if (!created) { res.status(500).json({ error: "שגיאה ביצירת משתמש" }); return; }

    void notifySync({ action: "salesperson_upserted", id: created.id });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to create user");
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === "23505" || (message.includes("duplicate key") && message.includes("email"))) {
      res.status(409).json({ error: "כתובת המייל כבר רשומה עבור משתמש אחר" });
      return;
    }
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// PATCH /admin/users/:id — update an app_user
router.patch("/admin/users/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) { res.status(401).json({ error: "לא מורשה" }); return; }

    const id = String(req.params["id"]);
    const { full_name, email, phone, role, is_active } = req.body as {
      full_name?: string; email?: string; phone?: string; role?: string; is_active?: boolean;
    };

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (full_name !== undefined) patch["full_name"] = full_name?.trim() || null;
    if (email !== undefined) {
      if (!email.includes("@")) { res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return; }
      patch["email"] = email.trim().toLowerCase();
    }
    if (phone !== undefined) patch["phone"] = phone?.trim() || null;
    if (role !== undefined) {
      const normalizedRole = normalizeRole(role);
      if (!isValidRole(normalizedRole)) {
        res.status(400).json({ error: "תפקיד משתמש לא תקין" });
        return;
      }
      patch["role"] = normalizedRole;
    }
    if (is_active !== undefined) patch["is_active"] = is_active;

    const [updated] = await db.update(appUsersTable)
      .set(patch)
      .where(and(eq(appUsersTable.id, id), isNull(appUsersTable.deleted_at)))
      .returning();

    if (!updated) { res.status(404).json({ error: "משתמש לא נמצא" }); return; }

    void notifySync({ action: "salesperson_upserted", id: updated.id });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update user");
    // unique constraint violation — מייל כבר קיים אצל משתמש אחר
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("duplicate key") && msg.includes("email")) {
      res.status(409).json({ error: "כתובת המייל כבר רשומה עבור משתמש אחר" });
      return;
    }
    res.status(500).json({ error: "שגיאת שרת" });
  }
});

// DELETE /admin/users/:id — soft-delete an app_user
router.delete("/admin/users/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) { res.status(401).json({ error: "לא מורשה" }); return; }

    const id = String(req.params["id"]);

    const [deleted] = await db.update(appUsersTable)
      .set({ deleted_at: new Date(), is_active: false, updated_at: new Date() })
      .where(and(eq(appUsersTable.id, id), isNull(appUsersTable.deleted_at)))
      .returning();

    if (!deleted) { res.status(404).json({ error: "משתמש לא נמצא" }); return; }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete user");
    res.status(500).json({ error: "שגיאת שרת" });
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
