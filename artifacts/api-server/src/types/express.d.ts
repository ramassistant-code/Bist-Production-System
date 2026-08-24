import type { AppUser } from "@workspace/db/schema";

declare global {
  namespace Express {
    interface Request {
      appUser?: AppUser;
    }
  }
}

export {};