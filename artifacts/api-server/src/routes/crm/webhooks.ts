import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { ingestLead, type LeadIntakePayload } from "../../services/crm/intake";
import {
  rebuildFreeText,
  RebuildFreeTextError,
} from "../../services/crm/rebuild-free-text";

const router: IRouter = Router();

export function validSecret(
  received: string | undefined,
  expected: string,
): boolean {
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

router.post(
  "/webhooks/lead",
  async (req: Request, res: Response): Promise<void> => {
    const expectedSecret = process.env.CRM_INTAKE_SECRET?.trim();
    const receivedSecret = req.header("x-crm-intake-secret");
    if (!expectedSecret || !validSecret(receivedSecret, expectedSecret)) {
      res.status(401).json({ error: "סוד קליטת הליד חסר או שגוי" });
      return;
    }

    const payload =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as LeadIntakePayload)
        : ({} as LeadIntakePayload);
    const source =
      typeof payload.source === "string" && payload.source.trim()
        ? payload.source.trim()
        : "facebook_lead_ads";

    const result = await ingestLead(payload, source);
    res.status(200).json(result);
  },
);

router.post(
  "/jobs/rebuild-free-text",
  async (req: Request, res: Response): Promise<void> => {
    const expectedSecret = process.env.CRM_INTAKE_SECRET?.trim();
    const receivedSecret = req.header("x-crm-intake-secret");
    if (!expectedSecret || !validSecret(receivedSecret, expectedSecret)) {
      res.status(401).json({ error: "סוד קליטת הליד חסר או שגוי" });
      return;
    }

    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const formId =
      typeof body["form_id"] === "string" ? body["form_id"].trim() : "";
    const questions = body["questions"];
    const dryRun = body["dry_run"] !== false;

    // בקשה פגומה היא שגיאת קורא, ולכן 400. הכלל "ה-4xx היחיד הוא סוד שגוי"
    // שייך ל-webhook של הלידים, שם 4xx גורם למטא לנסות שוב — כאן הקורא הוא
    // n8n בג'וב תחזוקה, ו-500 היה שולח מפעיל לחפש תקלת שרת שאינה קיימת.
    if (!formId || !Array.isArray(questions)) {
      res.status(400).json({ error: "גוף הבקשה לשחזור אינו תקין" });
      return;
    }

    try {
      const report = await rebuildFreeText(formId, questions, dryRun);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof RebuildFreeTextError) {
        res.status(400).json({ error: err.message });
        return;
      }
      req.log.error({ err, formId }, "Failed to rebuild CRM inquiry free text");
      res.status(500).json({ error: "שגיאה בשחזור free_text" });
    }
  },
);

export default router;
