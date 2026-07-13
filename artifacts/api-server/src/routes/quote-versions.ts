import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabase-admin";
import { logger } from "../lib/logger";
import {
  renderQuoteHtml,
  type PdfConfig,
  type PartySnapshot,
  type ItemSnapshot,
  type TotalsSnapshot,
  type TermsSnapshot,
  type NotesSnapshot,
} from "../lib/quote-html";

const router = Router();

// ── POST /quote-versions/:quoteVersionId/generate-pdf ─────────────────────────
// Generates a PDF from a saved quote version snapshot using the active template.
// Body: { templateId?: string | null }
// Response: { url: string, document_id: string, download_filename: string }

router.post(
  "/quote-versions/:quoteVersionId/generate-pdf",
  async (req: Request, res: Response): Promise<void> => {
    const quoteVersionId = String(req.params["quoteVersionId"]);

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    const { data: userData, error: authErr } =
      await supabaseAdmin.auth.getUser(token);
    if (authErr || !userData?.user) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }
    const userId = userData.user.id;

    let docId: string | null = null;

    try {
      // ── 1. Load quote version ─────────────────────────────────────────────
      const { data: version, error: vErr } = await supabaseAdmin
        .from("quote_versions")
        .select(
          "id, quote_id, version_number, status, party_snapshot, items_snapshot, totals_snapshot, terms_snapshot, notes_snapshot, created_at, approved_at",
        )
        .eq("id", quoteVersionId)
        .single();

      if (vErr || !version) {
        res.status(404).json({ error: "גרסת הצעה לא נמצאה" });
        return;
      }

      // ── 2. Load quote number ──────────────────────────────────────────────
      const { data: quote, error: qErr } = await supabaseAdmin
        .from("quotes")
        .select("id, quote_number")
        .eq("id", String(version.quote_id))
        .single();

      if (qErr || !quote) {
        res.status(404).json({ error: "הצעת מחיר לא נמצאה" });
        return;
      }

      // ── 3. Load PDF template ──────────────────────────────────────────────
      const { templateId } = (req.body ?? {}) as { templateId?: string | null };

      let templateQuery = supabaseAdmin
        .from("pdf_templates")
        .select("id, template_key, version, configuration")
        .eq("document_type", "quote");

      if (templateId) {
        templateQuery = templateQuery.eq("id", templateId);
      } else {
        templateQuery = templateQuery
          .eq("status", "active")
          .eq("is_default", true);
      }

      const { data: template, error: tErr } = await templateQuery.single();

      if (tErr || !template) {
        res.status(404).json({ error: "לא נמצא טמפלט PDF פעיל" });
        return;
      }

      // ── 4. Create quote_documents record via DB function ──────────────────
      const { data: docRow, error: docErr } = await supabaseAdmin
        .rpc("create_quote_pdf_generation", {
          p_quote_version_id: quoteVersionId,
          p_template_id: String(template.id),
          p_generated_by: userId,
        })
        .single();

      if (docErr || !docRow) {
        logger.error({ err: docErr }, "create_quote_pdf_generation failed");
        res.status(500).json({ error: "שגיאה ביצירת רשומת המסמך" });
        return;
      }

      docId = (docRow as { id: string }).id;

      // ── 5. Mark in-progress + store template metadata ─────────────────────
      await supabaseAdmin
        .from("quote_documents")
        .update({
          generation_status: "in_progress",
          generation_started_at: new Date().toISOString(),
          template_id: template.id,
          template_key: template.template_key,
          template_version: template.version,
        })
        .eq("id", docId);

      // ── 6. Render HTML ────────────────────────────────────────────────────
      const html = renderQuoteHtml({
        config: template.configuration as unknown as PdfConfig,
        quoteNumber: String(quote.quote_number),
        issueDate: String(version.approved_at ?? version.created_at),
        party: version.party_snapshot as unknown as PartySnapshot | null,
        items: (version.items_snapshot as unknown as ItemSnapshot[]) ?? [],
        totals: version.totals_snapshot as unknown as TotalsSnapshot | null,
        terms: version.terms_snapshot as unknown as TermsSnapshot | null,
        notes: version.notes_snapshot as unknown as NotesSnapshot | null,
      });

      // ── 7. Generate PDF via Playwright ────────────────────────────────────
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      let pdfBuffer: Buffer;
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const rawPdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
        });
        pdfBuffer = Buffer.from(rawPdf);
      } finally {
        await browser.close();
      }

      // ── 8. Upload to Supabase Storage ─────────────────────────────────────
      const storagePath = `${String(quote.id)}/${docId}.pdf`;
      const downloadFilename = `${String(quote.quote_number)}_v${String(version.version_number)}.pdf`;

      const { error: uploadErr } = await supabaseAdmin.storage
        .from("quote-pdfs")
        .upload(storagePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) {
        throw new Error(`שגיאה בהעלאת הקובץ: ${uploadErr.message}`);
      }

      // ── 9. Mark completed ─────────────────────────────────────────────────
      await supabaseAdmin
        .from("quote_documents")
        .update({
          generation_status: "completed",
          storage_path: storagePath,
          download_filename: downloadFilename,
          file_size_bytes: pdfBuffer.length,
          generated_at: new Date().toISOString(),
          generated_by: userId,
        })
        .eq("id", docId);

      // ── 10. Create signed URL (1 hour) ────────────────────────────────────
      const { data: signedData, error: signErr } =
        await supabaseAdmin.storage
          .from("quote-pdfs")
          .createSignedUrl(storagePath, 3600);

      if (signErr || !signedData?.signedUrl) {
        throw new Error("שגיאה ביצירת קישור להורדה");
      }

      res.json({
        url: signedData.signedUrl,
        document_id: docId,
        download_filename: downloadFilename,
      });
    } catch (err) {
      logger.error({ err }, "POST /quote-versions/:id/generate-pdf error");

      if (docId) {
        await supabaseAdmin
          .from("quote_documents")
          .update({
            generation_status: "failed",
            generation_error:
              err instanceof Error ? err.message : String(err),
          })
          .eq("id", docId)
          .catch((e: unknown) =>
            logger.error({ err: e }, "Failed to mark document as failed"),
          );
      }

      res.status(500).json({
        error: err instanceof Error ? err.message : "שגיאה ביצירת PDF",
      });
    }
  },
);

export default router;
