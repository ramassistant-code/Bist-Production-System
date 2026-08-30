import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { ingestLead, type LeadIntakePayload } from "../../services/crm/intake";

const router: IRouter = Router();

function validSecret(received: string | undefined, expected: string): boolean {
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

export default router;
