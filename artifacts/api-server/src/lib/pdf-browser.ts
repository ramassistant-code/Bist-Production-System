// ── Shared Chromium instance for PDF generation ──────────────────────────────
// מפעיל דפדפן אחד ומשאיר אותו פתוח לשימוש חוזר — במקום הפעלה מאפס בכל הפקה
// (הפעלת Chromium קרה היא החלק הכבד ב-30-40 השניות שנמדדו).

import { execSync } from "node:child_process";
import type { Browser } from "playwright";
import { logger } from "./logger";

let browserPromise: Promise<Browser> | null = null;

function detectExecutablePath(): string | undefined {
  try {
    return (
      execSync(
        "which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ''",
        { encoding: "utf-8" },
      ).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: detectExecutablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  // אם הדפדפן קורס/נסגר — נאפס כדי שההפקה הבאה תפעיל חדש
  browser.on("disconnected", () => {
    browserPromise = null;
    logger.warn("pdf-browser: chromium disconnected — will relaunch on next request");
  });
  return browser;
}

/** מחזיר דפדפן משותף; מפעיל אחד חדש רק אם אין או שהקודם נסגר. */
export async function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getSharedBrowser();
  }
  return browser;
}

/** חימום מראש בעליית השרת — כדי שההפקה הראשונה לא תשלם את מחיר ההפעלה. */
export function warmupPdfBrowser(): void {
  getSharedBrowser()
    .then(() => logger.info("pdf-browser: chromium warmed up and ready"))
    .catch((err) => logger.warn({ err }, "pdf-browser: warmup failed (will retry on demand)"));
}
