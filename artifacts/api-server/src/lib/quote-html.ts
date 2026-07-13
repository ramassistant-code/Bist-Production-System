// Renders a quote snapshot to a self-contained A4 HTML string for PDF generation.
// All styles are inline — no external resources.

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
  labels?: PdfLabels;
}

export interface ComponentSnapshot {
  component_name_snapshot?: string;
  component_description_snapshot?: string;
  quantity?: number;
  customer_note?: string;
}

export interface ItemSnapshot {
  product_name_snapshot?: string;
  product_description_snapshot?: string;
  quantity?: number;
  unit_price?: number;
  line_subtotal?: number;
  line_total_with_vat?: number;
  customer_note?: string;
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

  // Products rows HTML
  const productsHtml = cfg.show_products
    ? items
        .map((item) => {
          const compRows = cfg.show_components
            ? (item.components_snapshot ?? [])
                .map(
                  (c) => `
              <tr style="background:#f9fafb;border-bottom:1px solid #f0f0f0;">
                <td style="padding:6px 12px 6px 32px;color:#374151;font-size:12px;">↳ ${c.component_name_snapshot ?? "—"}</td>
                <td style="padding:6px 12px;text-align:center;font-size:12px;color:#374151;">${c.quantity ?? 1}</td>
                <td style="padding:6px 12px;text-align:center;font-size:12px;color:#9ca3af;">—</td>
                <td style="padding:6px 12px;text-align:center;font-size:12px;color:#9ca3af;">—</td>
              </tr>
              ${
                cfg.show_component_description && c.component_description_snapshot
                  ? `<tr style="background:#f9fafb;"><td colspan="4" style="padding:2px 12px 6px 32px;color:#6b7280;font-size:11px;">${c.component_description_snapshot}</td></tr>`
                  : ""
              }
              ${
                cfg.show_component_customer_notes && c.customer_note
                  ? `<tr style="background:#fef9f0;"><td colspan="4" style="padding:2px 12px 6px 32px;color:#92400e;font-size:11px;">💬 ${c.customer_note}</td></tr>`
                  : ""
              }
            `,
                )
                .join("")
            : "";

          return `
          <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:10px 12px;font-weight:600;color:#111827;">${item.product_name_snapshot ?? "—"}</td>
            <td style="padding:10px 12px;text-align:center;color:#374151;">${item.quantity ?? 1}</td>
            <td style="padding:10px 12px;text-align:center;color:#374151;">${fmtILS(item.unit_price)}</td>
            <td style="padding:10px 12px;text-align:center;font-weight:600;color:#111827;">${fmtILS(item.line_subtotal)}</td>
          </tr>
          ${
            cfg.show_product_description && item.product_description_snapshot
              ? `<tr><td colspan="4" style="padding:3px 12px 8px;color:#6b7280;font-size:12px;white-space:pre-wrap;">${item.product_description_snapshot}</td></tr>`
              : ""
          }
          ${
            cfg.show_product_customer_notes && item.customer_note
              ? `<tr><td colspan="4" style="padding:3px 12px 8px;color:#92400e;background:#fef3c7;font-size:12px;">💬 ${item.customer_note}</td></tr>`
              : ""
          }
          ${compRows}
        `;
        })
        .join("")
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
        <div style="flex:1;"><div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${L.full_name}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        <div style="flex:1;"><div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${L.id_or_company_number}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        <div style="flex:1;"><div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${L.signature}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>
        ${cfg.show_signature_date ? `<div style="flex:1;"><div style="font-size:11px;color:#6b7280;margin-bottom:4px;">${L.date}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>` : ""}
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
  .page { width: 100%; padding: 48px 56px; min-height: 100vh; }
  table { width: 100%; border-collapse: collapse; }
  th { background-color: #1e3a5f !important; color: white; padding: 10px 12px; font-size: 13px; font-weight: 600; }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:3px solid #1e3a5f;padding-bottom:20px;">
    <div>
      ${
        cfg.show_logo
          ? `<div style="width:72px;height:36px;background-color:#1e3a5f;border-radius:6px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:15px;line-height:36px;text-align:center;padding:0 12px;">BIST</div>`
          : ""
      }
      ${cfg.company_name ? `<div style="font-size:13px;color:#6b7280;margin-top:8px;">${cfg.company_name}</div>` : ""}
      ${cfg.company_introduction ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;max-width:240px;">${cfg.company_introduction}</div>` : ""}
    </div>
    <div style="text-align:left;">
      <div style="font-size:22px;font-weight:700;color:#1e3a5f;">${cfg.document_title}</div>
      ${cfg.show_quote_number ? `<div style="font-size:13px;color:#374151;margin-top:6px;"><span style="color:#6b7280;">מס׳ הצעה:</span> ${quoteNumber}</div>` : ""}
      ${cfg.show_issue_date ? `<div style="font-size:13px;color:#374151;margin-top:2px;"><span style="color:#6b7280;">תאריך הפקה:</span> ${fmtDate(issueDate)}</div>` : ""}
      ${cfg.show_valid_until && terms?.valid_until ? `<div style="font-size:13px;color:#374151;margin-top:2px;"><span style="color:#6b7280;">בתוקף עד:</span> ${fmtDate(terms.valid_until)}</div>` : ""}
    </div>
  </div>

  <!-- Client details -->
  <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">${L.client_details}</div>
    <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">${L.for_client}: ${clientName}</div>
    <div style="display:flex;gap:28px;flex-wrap:wrap;">
      ${cfg.show_client_email && clientEmail ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.email}:</span> ${clientEmail}</div>` : ""}
      ${cfg.show_client_phone && clientPhone ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.phone}:</span> ${clientPhone}</div>` : ""}
    </div>
  </div>

  <!-- Products table -->
  ${
    cfg.show_products
      ? `<div style="margin-bottom:24px;">
    <table>
      <thead>
        <tr>
          <th style="text-align:right;">פריט</th>
          <th style="text-align:center;width:72px;">${L.quantity}</th>
          <th style="text-align:center;width:108px;">${L.unit_price}</th>
          <th style="text-align:center;width:108px;">${L.product_total}</th>
        </tr>
      </thead>
      <tbody style="color:#374151;font-size:14px;">
        ${productsHtml}
      </tbody>
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
        <tr style="border-top:2px solid #1e3a5f;">
          <td style="padding:8px 0 0;color:#1e3a5f;font-weight:700;font-size:15px;">${L.total_including_vat}</td>
          <td style="padding:8px 0 0;text-align:left;color:#1e3a5f;font-weight:700;font-size:15px;">${fmtILS(totalWithVat)}</td>
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

  <!-- Signature -->
  ${sigHtml}

</div>
</body>
</html>`;
}
