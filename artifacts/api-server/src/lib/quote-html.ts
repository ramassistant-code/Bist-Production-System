// Renders a quote snapshot to a self-contained A4 HTML string for PDF generation.
// All styles are inline — no external resources.

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Load logo once at module init; works from both dist/ and src/ locations.
function _loadLogoDataUri(): string {
  const candidates = [
    join(__dirname, "assets", "bist-banner.png"),
    join(__dirname, "..", "src", "assets", "bist-banner.png"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const b64 = readFileSync(p).toString("base64");
      return `data:image/png;base64,${b64}`;
    }
  }
  return "";
}
const LOGO_DATA_URI = _loadLogoDataUri();

export interface PdfLabels {
  client_details?: string;
  for_client?: string;
  email?: string;
  phone?: string;
  quantity?: string;
  unit_price?: string;
  product_total?: string;
  notes?: string;
  general_notes?: string;
  customer_notes?: string;
  subtotal?: string;
  vat?: string;
  total_including_vat?: string;
  signature_title?: string;
  full_name?: string;
  id_or_company_number?: string;
  signature?: string;
  date?: string;
}

export interface PdfConfig {
  document_title?: string;
  summary_title?: string;
  company_name?: string;
  company_introduction?: string;
  show_logo?: boolean;
  show_quote_number?: boolean;
  show_issue_date?: boolean;
  show_valid_until?: boolean;
  show_client_email?: boolean;
  show_client_phone?: boolean;
  show_products?: boolean;
  show_product_description?: boolean;
  show_product_customer_notes?: boolean;
  show_components?: boolean;
  show_component_description?: boolean;
  show_component_customer_notes?: boolean;
  show_quote_general_notes?: boolean;
  show_customer_notes?: boolean;
  show_vat_breakdown?: boolean;
  show_signature_section?: boolean;
  show_signature_date?: boolean;
  below_client_text?: string;
  bottom_notes?: string;
  labels?: PdfLabels;
}

export interface ComponentSnapshot {
  component_name_snapshot?: string;
  component_description_snapshot?: string;
  quantity?: number;
  customer_note?: string;
  internal_note?: string;
  sort_order?: number;
}

export interface ItemSnapshot {
  product_name_snapshot?: string;
  product_description_snapshot?: string;
  quantity?: number;
  unit_price?: number;
  line_subtotal?: number;
  line_total_with_vat?: number;
  customer_note?: string;
  internal_note?: string;
  components_snapshot?: ComponentSnapshot[];
}

export interface TotalsSnapshot {
  vat_rate?: number;
  vat_amount?: number;
  total_with_vat?: number;
  discount_amount?: number;
  basket_manual_total?: number | null;
}

export interface TermsSnapshot {
  project_title?: string;
  valid_until?: string;
  payment_terms?: string | null;
  deposit_amount?: number;
}

export interface NotesSnapshot {
  customer_notes?: string | null;
  internal_notes?: string | null;
  operation_notes?: string | null;
}

export interface PartySnapshot {
  business_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  party_type?: string;
}

export interface RenderQuoteHtmlInput {
  config: PdfConfig;
  quoteNumber: string;
  issueDate: string;
  party: PartySnapshot | null;
  items: ItemSnapshot[];
  totals: TotalsSnapshot | null;
  terms: TermsSnapshot | null;
  notes: NotesSnapshot | null;
}

const DEFAULT_LABELS: Required<PdfLabels> = {
  client_details: "פרטי לקוח",
  for_client: "עבור",
  email: "מייל",
  phone: "טלפון",
  quantity: "כמות",
  unit_price: "מחיר ליחידה",
  product_total: 'סה"כ למוצר',
  notes: "הערות",
  general_notes: "הערות כלליות",
  customer_notes: "הערות לקוח",
  subtotal: 'סה"כ לפני מע"מ',
  vat: 'מע"מ',
  total_including_vat: 'סה"כ כולל מע"מ',
  signature_title: "על החתום",
  full_name: "שם מלא",
  id_or_company_number: 'ת"ז / ח"פ',
  signature: "חתימה",
  date: "תאריך",
};

function fmtILS(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₪${Number(n).toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function renderQuoteHtml(input: RenderQuoteHtmlInput): string {
  const { config, quoteNumber, issueDate, party, items, totals, terms, notes } = input;
  const L: Required<PdfLabels> = { ...DEFAULT_LABELS, ...(config.labels ?? {}) };

  const cfg: Required<Omit<PdfConfig, "labels">> = {
    document_title: config.document_title ?? "הצעת מחיר לחתימה",
    summary_title: config.summary_title ?? "סיכום",
    company_name: config.company_name ?? "BIST Productions",
    company_introduction: config.company_introduction ?? "",
    show_logo: config.show_logo !== false,
    show_quote_number: config.show_quote_number !== false,
    show_issue_date: config.show_issue_date !== false,
    show_valid_until: config.show_valid_until !== false,
    show_client_email: config.show_client_email !== false,
    show_client_phone: config.show_client_phone !== false,
    show_products: config.show_products !== false,
    show_product_description: config.show_product_description !== false,
    show_product_customer_notes: config.show_product_customer_notes !== false,
    show_components: config.show_components !== false,
    show_component_description: config.show_component_description !== false,
    show_component_customer_notes: config.show_component_customer_notes !== false,
    show_quote_general_notes: config.show_quote_general_notes !== false,
    show_customer_notes: config.show_customer_notes !== false,
    show_vat_breakdown: config.show_vat_breakdown !== false,
    show_signature_section: config.show_signature_section !== false,
    show_signature_date: config.show_signature_date !== false,
    below_client_text: config.below_client_text ?? "",
    bottom_notes: config.bottom_notes ?? "",
  };

  const clientName = party?.business_name || party?.contact_name || "—";
  const clientEmail = party?.email ?? "";
  const clientPhone = party?.phone ?? "";

  const subtotal =
    totals?.basket_manual_total != null
      ? totals.basket_manual_total
      : (totals?.total_with_vat ?? 0) - (totals?.vat_amount ?? 0);

  const vatRate = totals?.vat_rate ?? 0.18;
  const vatAmount = totals?.vat_amount ?? 0;
  const totalWithVat = totals?.total_with_vat ?? 0;

  // ── Products HTML (one <tbody> per product for page-break-inside:avoid) ────
  const productsHtml = cfg.show_products
    ? items.map((item) => {
        // Sort components by sort_order
        const sortedComponents = cfg.show_components
          ? (item.components_snapshot ?? [])
              .slice()
              .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
          : [];

        // Build component block (single cell spanning all 4 cols)
        const compBlockHtml = sortedComponents.length > 0
          ? `<tr>
              <td colspan="4" style="padding:0 12px 14px;">
                <div style="background-color:#f8f9fa;border-radius:6px;padding:10px 14px;">
                  ${sortedComponents.map((c) => `
                    <div style="padding:5px 0;${sortedComponents.indexOf(c) > 0 ? "margin-top:3px;" : ""}">
                      <span style="font-size:12px;color:#111827;font-weight:700;">${c.quantity ?? 1} ×</span>
                      <span style="font-size:12px;color:#4b5563;font-weight:500;margin-right:4px;">${c.component_name_snapshot ?? "—"}</span>
                      ${cfg.show_component_description && c.component_description_snapshot
                        ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.45;">${c.component_description_snapshot}</div>`
                        : ""}
                      ${cfg.show_component_customer_notes && c.customer_note
                        ? `<div style="font-size:12px;color:#1e40af;margin-top:2px;">💬 ${c.customer_note}</div>`
                        : ""}
                    </div>
                  `).join("")}
                </div>
              </td>
            </tr>`
          : "";

        return `
          <tbody style="page-break-inside:avoid;">
            <tr style="border-top:1px solid #e5e7eb;">
              <td style="padding:20px 12px 18px;font-weight:700;font-size:14px;color:#111827;width:55%;">${item.product_name_snapshot ?? "—"}</td>
              <td style="padding:20px 12px 18px;text-align:center;color:#374151;width:10%;font-size:14px;">${item.quantity ?? 1}</td>
              <td style="padding:20px 12px 18px;text-align:center;color:#374151;width:17.5%;font-size:14px;">${fmtILS(item.unit_price)}</td>
              <td style="padding:20px 12px 18px;text-align:center;font-weight:700;font-size:14px;color:#111827;width:17.5%;">${fmtILS(item.line_subtotal)}</td>
            </tr>
            ${cfg.show_product_description && item.product_description_snapshot
              ? `<tr>
                  <td colspan="4" style="padding:0 12px 12px;color:#4b5563;font-size:13px;line-height:1.45;white-space:pre-wrap;">${item.product_description_snapshot}</td>
                </tr>`
              : ""}
            ${cfg.show_product_customer_notes && item.customer_note
              ? `<tr>
                  <td colspan="4" style="padding:0 12px 12px;color:#1e40af;background-color:#eff6ff;font-size:13px;">💬 ${item.customer_note}</td>
                </tr>`
              : ""}
            ${compBlockHtml}
          </tbody>`;
      }).join("")
    : "";

  const vatPct = Math.round(vatRate * 100);

  const vatRowsHtml = cfg.show_vat_breakdown
    ? `
      <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">${L.subtotal}</td><td style="padding:4px 0;text-align:left;font-size:13px;">${fmtILS(subtotal)}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">${L.vat} (${vatPct}%)</td><td style="padding:4px 0;text-align:left;font-size:13px;">${fmtILS(vatAmount)}</td></tr>
    `
    : "";

  const sigHtml = cfg.show_signature_section
    ? `
    <div style="margin-top:32px;border-top:2px solid #e5e7eb;padding-top:20px;">
      <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:16px;">${L.signature_title}</div>
      <div style="display:flex;gap:24px;">
        <div style="flex:1;"><div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.full_name}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        <div style="flex:1;"><div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.id_or_company_number}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        <div style="flex:1;"><div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.signature}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        ${cfg.show_signature_date ? `<div style="flex:1;"><div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.date}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>` : ""}
      </div>
    </div>
  `
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; direction: rtl; background: white; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 100%; padding: 32px 56px 48px; }
  table { width: 100%; border-collapse: collapse; }
  th { background-color: #111827 !important; color: white; padding: 11px 12px; font-size: 13px; font-weight: 600; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>

  ${
    cfg.show_logo && LOGO_DATA_URI
      ? `<img src="${LOGO_DATA_URI}" alt="BIST" style="width:100%;display:block;margin:0;padding:0;" />`
      : `<div style="width:100%;background:#111;padding:18px 56px;"><span style="color:#fff;font-weight:700;font-size:20px;">BIST Productions</span></div>`
  }

<div class="page">

  <!-- Header: quote title (right) + company name (left) -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #111827;padding-bottom:20px;margin-top:12px;">
    <div>
      <div style="font-size:22px;font-weight:700;color:#111827;">${cfg.document_title}</div>
      ${cfg.show_quote_number ? `<div style="font-size:13px;color:#374151;margin-top:8px;"><span style="color:#6b7280;">מס׳ הצעה:</span> ${quoteNumber}</div>` : ""}
      ${cfg.show_issue_date ? `<div style="font-size:13px;color:#374151;margin-top:3px;"><span style="color:#6b7280;">תאריך הפקה:</span> ${fmtDate(issueDate)}</div>` : ""}
      ${cfg.show_valid_until && terms?.valid_until ? `<div style="font-size:13px;color:#374151;margin-top:3px;"><span style="color:#6b7280;">בתוקף עד:</span> ${fmtDate(terms.valid_until)}</div>` : ""}
    </div>
    <div style="text-align:left;">
      ${cfg.company_name ? `<div style="font-size:14px;font-weight:600;color:#374151;">${cfg.company_name}</div>` : ""}
      ${cfg.company_introduction ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;max-width:200px;line-height:1.4;">${cfg.company_introduction}</div>` : ""}
    </div>
  </div>

  <!-- Client details -->
  <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:${cfg.below_client_text ? "12px" : "28px"};">
    <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">${L.client_details}</div>
    <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">${L.for_client}: ${clientName}</div>
    <div style="display:flex;gap:28px;flex-wrap:wrap;">
      ${cfg.show_client_email && clientEmail ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.email}:</span> ${clientEmail}</div>` : ""}
      ${cfg.show_client_phone && clientPhone ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.phone}:</span> ${clientPhone}</div>` : ""}
    </div>
  </div>
  ${cfg.below_client_text ? `<div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;margin-bottom:28px;padding:0 2px;">${cfg.below_client_text}</div>` : ""}

  <!-- Products table -->
  ${
    cfg.show_products
      ? `<div style="margin-bottom:28px;">
    <table>
      <thead>
        <tr>
          <th style="text-align:right;width:55%;">פריט</th>
          <th style="text-align:center;width:10%;">${L.quantity}</th>
          <th style="text-align:center;width:17.5%;">${L.unit_price}</th>
          <th style="text-align:center;width:17.5%;">${L.product_total}</th>
        </tr>
      </thead>
      ${productsHtml}
    </table>
  </div>`
      : ""
  }

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-start;margin-bottom:24px;">
    <div style="min-width:280px;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
      <div style="font-weight:700;color:#111827;margin-bottom:10px;font-size:14px;">${cfg.summary_title}</div>
      <table style="font-size:13px;color:#374151;">
        ${vatRowsHtml}
        <tr style="border-top:2px solid #111827;">
          <td style="padding:8px 0 0;color:#111827;font-weight:700;font-size:15px;">${L.total_including_vat}</td>
          <td style="padding:8px 0 0;text-align:left;color:#111827;font-weight:700;font-size:15px;">${fmtILS(totalWithVat)}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Notes -->
  ${
    cfg.show_quote_general_notes && terms?.payment_terms
      ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px;">${L.general_notes}</div><div style="font-size:13px;color:#374151;background:#f9fafb;border-radius:6px;padding:10px 12px;border:1px solid #e5e7eb;">${terms.payment_terms}</div></div>`
      : ""
  }
  ${
    cfg.show_customer_notes && notes?.customer_notes
      ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px;">${L.customer_notes}</div><div style="font-size:13px;color:#374151;background:#fef9f0;border-radius:6px;padding:10px 12px;border:1px solid #fde68a;">${notes.customer_notes}</div></div>`
      : ""
  }
  ${
    cfg.bottom_notes
      ? `<div style="margin-bottom:16px;margin-top:8px;"><div style="font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap;padding:12px 14px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;">${cfg.bottom_notes}</div></div>`
      : ""
  }

  <!-- Signature -->
  ${sigHtml}

</div>
</body>
</html>`;
}
