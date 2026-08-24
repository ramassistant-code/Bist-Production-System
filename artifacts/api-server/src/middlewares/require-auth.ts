import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { appUsersTable, type AppUser } from "@workspace/db/schema";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const APP_USER_CACHE_TTL_MS = 60_000;

type CachedAppUser = {
  expiresAt: number;
  appUser: AppUser | null;
};

const appUserCache = new Map<string, CachedAppUser>();

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Verifies the Supabase token and returns the authenticated Supabase identity.
 * The app_users lookup belongs to requireAuth so all CRM requests receive a
 * typed, active application user on req.appUser.
 */
export async function getAuthenticatedUser(
  req: Request,
): Promise<{ id: string; email: string } | null> {
  const token = bearerToken(req);
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user || !data.user.email) return null;

  return { id: data.user.id, email: data.user.email };
}

async function getActiveAppUser(
  req: Request,
  token: string,
  email: string,
): Promise<AppUser | null> {
  const cached = appUserCache.get(token);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.appUser;
    appUserCache.delete(token);
  }

  const [appUser] = await db
    .select()
    .from(appUsersTable)
    .where(
      and(
        eq(appUsersTable.email, email),
        eq(appUsersTable.is_active, true),
        isNull(appUsersTable.deleted_at),
      ),
    )
    .limit(1);

  appUserCache.set(token, {
    appUser: appUser ?? null,
    expiresAt: Date.now() + APP_USER_CACHE_TTL_MS,
  });

  return appUser ?? null;
}

export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = bearerToken(req);
    const authUser = await getAuthenticatedUser(req);
    if (!token || !authUser) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    const appUser = await getActiveAppUser(req, token, authUser.email);
    if (!appUser) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    req.appUser = appUser;
    next();
  } catch (err) {
    logger.error({ err }, "CRM authentication failed");
    res.status(401).json({ error: "לא מורשה" });
  }
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.appUser) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    if (!roles.includes(req.appUser.role ?? "")) {
      res.status(403).json({ error: "אין לך הרשאה לפעולה זו" });
      return;
    }

    next();
  };
}