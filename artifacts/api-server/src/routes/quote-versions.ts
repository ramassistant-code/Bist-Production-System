import { execSync } from "child_process";
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

      const doc = docRow as { id: string; revision: number };
      docId = doc.id;
      const docRevision = doc.revision;

      // ── 5. Mark generating ────────────────────────────────────────────────
      // Allowed status values: pending | generating | failed
      await supabaseAdmin
        .from("quote_documents")
        .update({
          generation_status: "generating",
          generation_started_at: new Date().toISOString(),
        })
        .eq("id", docId);

      // ── 6. Render HTML ────────────────────────────────────────────────────
      const html = renderQuoteHtml({
        config: template.configuration as unknown as PdfConfig,
        quoteNumber: String(quote.quote_number),
        issueDate: new Date().toISOString(),
        party: version.party_snapshot as unknown as PartySnapshot | null,
        items: (version.items_snapshot as unknown as ItemSnapshot[]) ?? [],
        totals: version.totals_snapshot as unknown as TotalsSnapshot | null,
        terms: version.terms_snapshot as unknown as TermsSnapshot | null,
        notes: version.notes_snapshot as unknown as NotesSnapshot | null,
      });

      // ── 7. Generate PDF via Playwright ────────────────────────────────────
      // Use the nix-installed system Chromium to avoid missing shared library
      // issues with Playwright's bundled binary on NixOS.
      const { chromium } = await import("playwright");
      let executablePath: string | undefined;
      try {
        executablePath = execSync(
          "which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ''",
          { encoding: "utf-8" },
        ).trim() || undefined;
      } catch {
        executablePath = undefined;
      }

      const browser = await chromium.launch({
        executablePath,
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
      const storagePath = `quotes/${String(quote.id)}/versions/${quoteVersionId}/revisions/${docRevision}/quote.pdf`;
      const downloadFilename = `${String(quote.quote_number)}_v${String(version.version_number)}_r${docRevision}.pdf`;

      const { error: uploadErr } = await supabaseAdmin.storage
        .from("quote-pdfs")
        .upload(storagePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) {
        throw new Error(`שגיאה בהעלאת הקובץ: ${uploadErr.message}`);
      }

      // ── 9. Mark done (status remains "generating" = in-progress/done)
      // Note: constraint only allows pending | generating | failed; no "completed"
      const { error: doneErr } = await supabaseAdmin
        .from("quote_documents")
        .update({
          generation_status: "generating",
          storage_path: storagePath,
          download_filename: downloadFilename,
          file_size_bytes: pdfBuffer.length,
          generated_at: new Date().toISOString(),
        })
        .eq("id", docId);
      if (doneErr) {
        logger.error({ err: doneErr }, "Failed to mark document done");
      }

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
        const { error: failErr } = await supabaseAdmin
          .from("quote_documents")
          .update({
            generation_status: "failed",
            generation_error:
              err instanceof Error ? err.message : String(err),
          })
          .eq("id", docId);
        if (failErr) {
          logger.error({ err: failErr }, "Failed to mark document as failed");
        }
      }

      res.status(500).json({
        error: err instanceof Error ? err.message : "שגיאה ביצירת PDF",
      });
    }
  },
);

// ── GET /quote-versions/:quoteVersionId/latest-pdf ────────────────────────────
// Returns a fresh signed URL for the latest generated PDF of this version.
// Response: { url, document_id, download_filename, revision } | 404

router.get(
  "/quote-versions/:quoteVersionId/latest-pdf",
  async (req: Request, res: Response): Promise<void> => {
    const quoteVersionId = String(req.params["quoteVersionId"]);

    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }
    const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !userData?.user) {
      res.status(401).json({ error: "לא מורשה" });
      return;
    }

    const { data: doc } = await supabaseAdmin
      .from("quote_documents")
      .select("id, storage_path, download_filename, revision")
      .eq("quote_version_id", quoteVersionId)
      .not("storage_path", "is", null)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!doc?.storage_path) {
      res.status(404).json({ error: "לא נמצא PDF עבור גרסה זו" });
      return;
    }

    const { data: signedData, error: signErr } = await supabaseAdmin.storage
      .from("quote-pdfs")
      .createSignedUrl(String(doc.storage_path), 3600);

    if (signErr || !signedData?.signedUrl) {
      res.status(500).json({ error: "שגיאה ביצירת קישור" });
      return;
    }

    res.json({
      url: signedData.signedUrl,
      document_id: doc.id,
      download_filename: doc.download_filename ?? "quote.pdf",
      revision: doc.revision,
    });
  },
);

export default router;
