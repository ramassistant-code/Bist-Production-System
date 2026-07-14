import { useState, useMemo } from "react";
import bistBannerUrl from "../assets/bist-banner.png";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth-context";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfTemplateLabels {
  client_details: string;
  for_client: string;
  email: string;
  phone: string;
  quantity: string;
  unit_price: string;
  product_total: string;
  notes: string;
  general_notes: string;
  customer_notes: string;
  subtotal: string;
  vat: string;
  total_including_vat: string;
  signature_title: string;
  full_name: string;
  id_or_company_number: string;
  signature: string;
  date: string;
}

interface PdfTemplateConfiguration {
  document_title: string;
  summary_title: string;
  company_name: string;
  company_introduction: string;
  show_logo: boolean;
  show_quote_number: boolean;
  show_issue_date: boolean;
  show_valid_until: boolean;
  show_client_email: boolean;
  show_client_phone: boolean;
  show_products: boolean;
  show_product_description: boolean;
  show_product_customer_notes: boolean;
  show_components: boolean;
  show_component_description: boolean;
  show_component_customer_notes: boolean;
  show_quote_general_notes: boolean;
  show_customer_notes: boolean;
  show_vat_breakdown: boolean;
  show_signature_section: boolean;
  show_signature_date: boolean;
  below_client_text: string;
  bottom_notes: string;
  labels: PdfTemplateLabels;
  language: string;
  direction: string;
}

interface PdfTemplate {
  id: string;
  template_key: string;
  name: string;
  document_type: string;
  version: number;
  status: string;
  is_default: boolean;
  template_path: string;
  configuration: PdfTemplateConfiguration;
  description: string | null;
  created_by: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: string;
  version: number;
  name: string;
  status: string;
  created_at: string;
  activated_at: string | null;
  created_by: string | null;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_LABELS: PdfTemplateLabels = {
  client_details: "פרטי לקוח",
  for_client: "עבור",
  email: "מייל",
  phone: "טלפון",
  quantity: "כמות",
  unit_price: "מחיר ליחידה",
  product_total: "סה״כ למוצר",
  notes: "הערות",
  general_notes: "הערות כלליות",
  customer_notes: "הערות לקוח",
  subtotal: "סה״כ לפני מע״מ",
  vat: "מע״מ",
  total_including_vat: "סה״כ כולל מע״מ",
  signature_title: "על החתום",
  full_name: "שם מלא",
  id_or_company_number: "ת״ז / ח״פ",
  signature: "חתימה",
  date: "תאריך",
};

const DEFAULT_CONFIG: PdfTemplateConfiguration = {
  document_title: "הצעת מחיר לחתימה",
  summary_title: "סיכום",
  company_name: "BIST Productions",
  company_introduction: "",
  show_logo: true,
  show_quote_number: true,
  show_issue_date: true,
  show_valid_until: true,
  show_client_email: true,
  show_client_phone: true,
  show_products: true,
  show_product_description: true,
  show_product_customer_notes: true,
  show_components: true,
  show_component_description: true,
  show_component_customer_notes: true,
  show_quote_general_notes: true,
  show_customer_notes: true,
  show_vat_breakdown: true,
  show_signature_section: true,
  show_signature_date: true,
  below_client_text: "",
  bottom_notes: "",
  labels: DEFAULT_LABELS,
  language: "he",
  direction: "rtl",
};

function mergeConfig(raw: Partial<PdfTemplateConfiguration>): PdfTemplateConfiguration {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    labels: { ...DEFAULT_LABELS, ...(raw.labels ?? {}) },
  };
}

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE = {
  quote_number: "Q-2026-00125",
  issue_date: "13.07.2026",
  valid_until: "27.07.2026",
  client: { name: "ישראל ישראלי", email: "israel@example.com", phone: "050-0000000" },
  products: [
    {
      name: "חבילת פודקאסט",
      quantity: 1,
      unit_price: 1950,
      total_price: 1950,
      description: "תיאור מוצר לדוגמה",
      customer_note: "הערה ללקוח לדוגמה",
      components: [
        {
          order: 1,
          name: "שעת צילום באולפן",
          quantity: 1,
          description: "צילום מלא באולפן BIST",
          customer_note: "הערה לרכיב לדוגמה",
        },
      ],
    },
  ],
  subtotal: 1950,
  vat_rate: 18,
  vat_amount: 351,
  total_including_vat: 2301,
  general_notes: "ההצעה בתוקף ל-14 ימים",
  customer_notes: "הערות לקוח לדוגמה",
};

// ── HTML preview generator ────────────────────────────────────────────────────

function generatePreviewHtml(cfg: PdfTemplateConfiguration): string {
  const L = cfg.labels;
  const fmt = (n: number) =>
    n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const productsHtml = cfg.show_products
    ? SAMPLE.products
        .map(
          (p) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-weight:600;color:#111;">${p.name}</td>
        <td style="padding:10px 12px;text-align:center;">${p.quantity}</td>
        <td style="padding:10px 12px;text-align:center;">₪${fmt(p.unit_price)}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:600;">₪${fmt(p.total_price)}</td>
      </tr>
      ${
        cfg.show_product_description && p.description
          ? `<tr><td colspan="4" style="padding:4px 12px 8px;color:#6b7280;font-size:12px;">${p.description}</td></tr>`
          : ""
      }
      ${
        cfg.show_product_customer_notes && p.customer_note
          ? `<tr><td colspan="4" style="padding:4px 12px 8px;color:#92400e;background:#fef3c7;font-size:12px;">💬 ${p.customer_note}</td></tr>`
          : ""
      }
      ${
        cfg.show_components
          ? p.components
              .map(
                (c) => `
          <tr style="background:#f9fafb;">
            <td style="padding:6px 12px 6px 28px;color:#374151;font-size:13px;">↳ ${c.name}</td>
            <td style="padding:6px 12px;text-align:center;font-size:13px;">${c.quantity}</td>
            <td style="padding:6px 12px;text-align:center;font-size:13px;color:#9ca3af;">—</td>
            <td style="padding:6px 12px;text-align:center;font-size:13px;color:#9ca3af;">—</td>
          </tr>
          ${
            cfg.show_component_description && c.description
              ? `<tr style="background:#f9fafb;"><td colspan="4" style="padding:2px 12px 6px 28px;color:#6b7280;font-size:11px;">${c.description}</td></tr>`
              : ""
          }
          ${
            cfg.show_component_customer_notes && c.customer_note
              ? `<tr style="background:#fef9f0;"><td colspan="4" style="padding:2px 12px 6px 28px;color:#92400e;font-size:11px;">💬 ${c.customer_note}</td></tr>`
              : ""
          }
        `,
              )
              .join("")
          : ""
      }
    `,
        )
        .join("")
    : "";

  const vatHtml = cfg.show_vat_breakdown
    ? `
    <tr><td style="padding:4px 0;color:#6b7280;">${L.subtotal}</td><td style="padding:4px 0;text-align:left;">₪${fmt(SAMPLE.subtotal)}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">${L.vat} (${SAMPLE.vat_rate}%)</td><td style="padding:4px 0;text-align:left;">₪${fmt(SAMPLE.vat_amount)}</td></tr>
  `
    : "";

  const sigHtml = cfg.show_signature_section
    ? `
    <div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:20px;">
      <div style="font-weight:600;font-size:14px;color:#111;margin-bottom:16px;">${L.signature_title}</div>
      <div style="display:flex;gap:32px;">
        <div style="flex:1;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.full_name}</div>
          <div style="border-bottom:1px solid #d1d5db;height:28px;"></div>
        </div>
        <div style="flex:1;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.id_or_company_number}</div>
          <div style="border-bottom:1px solid #d1d5db;height:28px;"></div>
        </div>
        <div style="flex:1;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.signature}</div>
          <div style="border-bottom:1px solid #d1d5db;height:28px;"></div>
        </div>
        ${
          cfg.show_signature_date
            ? `<div style="flex:1;"><div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${L.date}</div><div style="border-bottom:1px solid #d1d5db;height:28px;"></div></div>`
            : ""
        }
      </div>
    </div>
  `
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
  .page { width: 794px; min-height: 1123px; background: white; margin: 16px auto; padding: 48px 56px; box-shadow: 0 2px 16px rgba(0,0,0,0.10); }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e3a5f; color: white; padding: 10px 12px; font-size: 13px; font-weight: 600; }
</style>
</head>
<body>
  ${cfg.show_logo ? `<img src="${bistBannerUrl}" style="width:100%;display:block;margin:0;padding:0;" alt="BIST banner"/>` : ""}

<div class="page">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;border-bottom:3px solid #1e3a5f;padding-bottom:20px;">
    <div>
      ${cfg.company_name ? `<div style="font-size:13px;color:#6b7280;">${cfg.company_name}</div>` : ""}
      ${cfg.company_introduction ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;max-width:260px;">${cfg.company_introduction}</div>` : ""}
    </div>
    <div style="text-align:left;">
      <div style="font-size:22px;font-weight:700;color:#1e3a5f;">${cfg.document_title}</div>
      ${cfg.show_quote_number ? `<div style="font-size:13px;color:#374151;margin-top:6px;"><span style="color:#6b7280;">מס׳ הצעה:</span> ${SAMPLE.quote_number}</div>` : ""}
      ${cfg.show_issue_date ? `<div style="font-size:13px;color:#374151;margin-top:2px;"><span style="color:#6b7280;">תאריך הפקה:</span> ${SAMPLE.issue_date}</div>` : ""}
      ${cfg.show_valid_until ? `<div style="font-size:13px;color:#374151;margin-top:2px;"><span style="color:#6b7280;">בתוקף עד:</span> ${SAMPLE.valid_until}</div>` : ""}
    </div>
  </div>

  <!-- Client details -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:${cfg.below_client_text ? "12px" : "24px"};">
    <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">${L.client_details}</div>
    <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:6px;">${L.for_client}: ${SAMPLE.client.name}</div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;">
      ${cfg.show_client_email ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.email}:</span> ${SAMPLE.client.email}</div>` : ""}
      ${cfg.show_client_phone ? `<div style="font-size:13px;color:#374151;"><span style="color:#6b7280;">${L.phone}:</span> ${SAMPLE.client.phone}</div>` : ""}
    </div>
  </div>
  ${cfg.below_client_text ? `<div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap;margin-bottom:24px;padding:0 2px;">${cfg.below_client_text}</div>` : ""}

  <!-- Products table -->
  ${
    cfg.show_products
      ? `
  <div style="margin-bottom:24px;">
    <table>
      <thead>
        <tr>
          <th style="text-align:right;">פריט</th>
          <th style="text-align:center;width:72px;">${L.quantity}</th>
          <th style="text-align:center;width:100px;">${L.unit_price}</th>
          <th style="text-align:center;width:100px;">${L.product_total}</th>
        </tr>
      </thead>
      <tbody style="color:#374151;font-size:14px;">
        ${productsHtml}
      </tbody>
    </table>
  </div>
  `
      : ""
  }

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-start;margin-bottom:24px;">
    <div style="min-width:280px;border:1px solid #e5e7eb;border-radius:8px;padding:16px;">
      <div style="font-weight:600;color:#111;margin-bottom:10px;">${cfg.summary_title}</div>
      <table style="font-size:13px;color:#374151;">
        ${vatHtml}
        <tr style="font-weight:700;font-size:15px;border-top:2px solid #1e3a5f;">
          <td style="padding:8px 0 0;color:#1e3a5f;">${L.total_including_vat}</td>
          <td style="padding:8px 0 0;text-align:left;color:#1e3a5f;">₪${fmt(SAMPLE.total_including_vat)}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Notes -->
  ${
    cfg.show_quote_general_notes && SAMPLE.general_notes
      ? `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;">${L.general_notes}</div><div style="font-size:13px;color:#374151;background:#f9fafb;border-radius:6px;padding:10px 12px;border:1px solid #e5e7eb;">${SAMPLE.general_notes}</div></div>`
      : ""
  }
  ${
    cfg.show_customer_notes && SAMPLE.customer_notes
      ? `<div style="margin-bottom:16px;"><div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;">${L.customer_notes}</div><div style="font-size:13px;color:#374151;background:#fef9f0;border-radius:6px;padding:10px 12px;border:1px solid #fde68a;">${SAMPLE.customer_notes}</div></div>`
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

// ── Fetch hook ────────────────────────────────────────────────────────────────

function useAuthedFetch() {
  const { session } = useAuth();
  const base = (import.meta.env.BASE_URL as string)?.replace(/\/$/, "") ?? "";
  return async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "שגיאה");
    }
    return res.json() as Promise<unknown>;
  };
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
          checked ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ${
            checked ? "translate-x-1" : "translate-x-4"
          }`}
        />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "active"
      ? "bg-green-100 text-green-700"
      : status === "archived"
        ? "bg-gray-100 text-gray-500"
        : "bg-yellow-100 text-yellow-700";
  const label =
    status === "active" ? "פעיל" : status === "archived" ? "בארכיון" : status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ── Format date ───────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function QuotePdfTemplate() {
  const authedFetch = useAuthedFetch();
  const qc = useQueryClient();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // --- Load active template
  const { data: activeData, isLoading: loadingTemplate } = useQuery<{ template: PdfTemplate }>({
    queryKey: ["pdf-template-active"],
    queryFn: () => authedFetch("/api/pdf-templates/quote/active") as Promise<{ template: PdfTemplate }>,
  });

  // --- Load history
  const { data: historyData, isLoading: loadingHistory } = useQuery<{ history: HistoryRow[] }>({
    queryKey: ["pdf-template-history"],
    queryFn: () => authedFetch("/api/pdf-templates/quote/history") as Promise<{ history: HistoryRow[] }>,
  });

  const active = activeData?.template ?? null;

  // --- Form state: initialized from loaded template
  const [formName, setFormName] = useState<string>("");
  const [config, setConfig] = useState<PdfTemplateConfiguration | null>(null);

  // Sync form when template loads (only once per template id)
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (active && active.id !== loadedId) {
    setFormName(active.name);
    setConfig(mergeConfig(active.configuration as Partial<PdfTemplateConfiguration>));
    setLoadedId(active.id);
  }

  const cfg = config ?? DEFAULT_CONFIG;

  const setField = <K extends keyof PdfTemplateConfiguration>(
    key: K,
    value: PdfTemplateConfiguration[K],
  ) => setConfig((prev) => ({ ...(prev ?? DEFAULT_CONFIG), [key]: value }));

  const setLabel = (key: keyof PdfTemplateLabels, value: string) =>
    setConfig((prev) => ({
      ...(prev ?? DEFAULT_CONFIG),
      labels: { ...(prev ?? DEFAULT_CONFIG).labels, [key]: value },
    }));

  // --- Live preview HTML
  const previewHtml = useMemo(() => generatePreviewHtml(cfg), [cfg]);

  // --- Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      return authedFetch("/api/pdf-templates/quote/publish", {
        method: "POST",
        body: JSON.stringify({ name: formName.trim(), configuration: cfg }),
      });
    },
    onSuccess: () => {
      setSuccessMsg("הגרסה החדשה פורסמה בהצלחה!");
      setErrorMsg(null);
      setLoadedId(null);
      void qc.invalidateQueries({ queryKey: ["pdf-template-active"] });
      void qc.invalidateQueries({ queryKey: ["pdf-template-history"] });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message ?? "שגיאה בפרסום");
      setSuccessMsg(null);
    },
  });

  const handlePublish = () => {
    setSuccessMsg(null);
    setErrorMsg(null);
    if (!formName.trim()) {
      setErrorMsg("שם הטמפלט נדרש");
      return;
    }
    publishMutation.mutate();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadingTemplate) {
    return (
      <Shell title="טמפלט הצעת מחיר">
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500">טוען טמפלט...</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="טמפלט הצעת מחיר">
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── Main split: form | preview ── */}
        <div className="flex flex-1 min-h-0 gap-0">

          {/* Form panel (right in RTL = start) */}
          <div className="w-[420px] flex-shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-5 space-y-6">

              {/* Template meta */}
              {active && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">גרסה פעילה</span>
                    <StatusBadge status={active.status} />
                  </div>
                  <div className="text-sm font-medium text-blue-900">גרסה {active.version}</div>
                  {active.activated_at && (
                    <div className="text-xs text-blue-700">הופעל: {fmtDate(active.activated_at)}</div>
                  )}
                </div>
              )}

              {/* Template name */}
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">שם הטמפלט</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="שם הטמפלט"
                />
              </div>

              {/* Text fields */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-1">תוכן כותרות</h3>
                {(
                  [
                    ["document_title", "כותרת המסמך"],
                    ["summary_title", "כותרת סיכום"],
                    ["company_name", "שם החברה"],
                  ] as [keyof PdfTemplateConfiguration, string][]
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <label className="block text-xs font-medium text-gray-600">{label}</label>
                    <input
                      type="text"
                      value={cfg[key] as string}
                      onChange={(e) => setField(key, e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600">הקדמת החברה</label>
                  <textarea
                    value={cfg.company_introduction}
                    onChange={(e) => setField("company_introduction", e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="משפט תיאור קצר (אופציונלי)"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-800 border-b border-gray-100 pb-1">הצגת שדות</h3>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">כותרת</p>
                  <Toggle checked={cfg.show_logo} onChange={(v) => setField("show_logo", v)} label="לוגו" />
                  <Toggle checked={cfg.show_quote_number} onChange={(v) => setField("show_quote_number", v)} label="מספר הצעה" />
                  <Toggle checked={cfg.show_issue_date} onChange={(v) => setField("show_issue_date", v)} label="תאריך הפקה" />
                  <Toggle checked={cfg.show_valid_until} onChange={(v) => setField("show_valid_until", v)} label="תאריך תפוגה" />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">פרטי לקוח</p>
                  <Toggle checked={cfg.show_client_email} onChange={(v) => setField("show_client_email", v)} label='דוא"ל לקוח' />
                  <Toggle checked={cfg.show_client_phone} onChange={(v) => setField("show_client_phone", v)} label="טלפון לקוח" />
                  <div className="space-y-1 pt-1">
                    <label className="block text-xs font-medium text-gray-600">טקסט מתחת לפרטי לקוח</label>
                    <textarea
                      value={cfg.below_client_text}
                      onChange={(e) => setField("below_client_text", e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="טקסט חופשי שיופיע מתחת לפרטי הלקוח (אופציונלי)"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">מוצרים</p>
                  <Toggle checked={cfg.show_products} onChange={(v) => setField("show_products", v)} label="טבלת מוצרים" />
                  <Toggle checked={cfg.show_product_description} onChange={(v) => setField("show_product_description", v)} label="תיאור מוצר" />
                  <Toggle checked={cfg.show_product_customer_notes} onChange={(v) => setField("show_product_customer_notes", v)} label="הערת לקוח למוצר" />
                  <Toggle checked={cfg.show_components} onChange={(v) => setField("show_components", v)} label="רכיבי מוצר" />
                  <Toggle checked={cfg.show_component_description} onChange={(v) => setField("show_component_description", v)} label="תיאור רכיב" />
                  <Toggle checked={cfg.show_component_customer_notes} onChange={(v) => setField("show_component_customer_notes", v)} label="הערת לקוח לרכיב" />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">סיכום ושונות</p>
                  <Toggle checked={cfg.show_vat_breakdown} onChange={(v) => setField("show_vat_breakdown", v)} label='פירוט מע"מ' />
                  <Toggle checked={cfg.show_quote_general_notes} onChange={(v) => setField("show_quote_general_notes", v)} label="הערות כלליות" />
                  <Toggle checked={cfg.show_customer_notes} onChange={(v) => setField("show_customer_notes", v)} label="הערות לקוח" />
                  <div className="space-y-1 pt-1">
                    <label className="block text-xs font-medium text-gray-600">הערות כלליות בתחתית ההצעה</label>
                    <textarea
                      value={cfg.bottom_notes}
                      onChange={(e) => setField("bottom_notes", e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="טקסט חופשי שיופיע מתחת לסיכום הכספי (תנאי תשלום, תנאים כלליים וכו׳)"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">חתימה</p>
                  <Toggle checked={cfg.show_signature_section} onChange={(v) => setField("show_signature_section", v)} label="סעיף חתימה" />
                  <Toggle checked={cfg.show_signature_date} onChange={(v) => setField("show_signature_date", v)} label="תאריך חתימה" />
                </div>
              </div>

              {/* Labels (collapsible) */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setLabelsOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-semibold text-gray-800"
                >
                  <span>תוויות במסמך</span>
                  {labelsOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </button>
                {labelsOpen && (
                  <div className="p-4 space-y-3 bg-white">
                    {(
                      [
                        ["client_details", "פרטי לקוח (כותרת)"],
                        ["for_client", "עבור (לקוח)"],
                        ["email", 'דוא"ל'],
                        ["phone", "טלפון"],
                        ["quantity", "כמות"],
                        ["unit_price", "מחיר ליחידה"],
                        ["product_total", "סה״כ למוצר"],
                        ["notes", "הערות"],
                        ["general_notes", "הערות כלליות"],
                        ["customer_notes", "הערות לקוח"],
                        ["subtotal", "סה״כ לפני מע״מ"],
                        ["vat", 'מע"מ'],
                        ["total_including_vat", 'סה"כ כולל מע"מ'],
                        ["signature_title", "כותרת חתימה"],
                        ["full_name", "שם מלא"],
                        ["id_or_company_number", 'ת"ז / ח"פ'],
                        ["signature", "חתימה"],
                        ["date", "תאריך"],
                      ] as [keyof PdfTemplateLabels, string][]
                    ).map(([key, placeholder]) => (
                      <div key={key} className="space-y-1">
                        <label className="block text-xs text-gray-500">{placeholder}</label>
                        <input
                          type="text"
                          value={cfg.labels[key]}
                          onChange={(e) => setLabel(key, e.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Feedback messages */}
              {successMsg && (
                <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  {successMsg}
                </div>
              )}
              {errorMsg && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {errorMsg}
                </div>
              )}

              {/* Buttons row */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={publishMutation.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl px-4 py-3 transition-colors"
                >
                  {publishMutation.isPending ? "מפרסם..." : "שמור ופרסם גרסה חדשה"}
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-xl px-3 py-3 transition-colors"
                  title="היסטוריית גרסאות"
                >
                  <History className="w-4 h-4" />
                  גרסאות
                </button>
              </div>

            </div>
          </div>

          {/* Preview panel (left in RTL = end) */}
          <div className="flex-1 bg-gray-100 overflow-auto flex flex-col">
            <div className="px-5 py-3 bg-white border-b border-gray-200 flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תצוגה מקדימה</span>
              <span className="text-xs text-gray-400">(נתוני דוגמה בלבד)</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <iframe
                title="preview"
                srcDoc={previewHtml}
                className="w-full border-0 rounded-lg shadow-lg"
                style={{ height: "1200px", background: "#f3f4f6" }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>

        {/* ── Version history dialog ── */}
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader>
              <DialogTitle>היסטוריית גרסאות טמפלט</DialogTitle>
            </DialogHeader>
            {loadingHistory ? (
              <p className="text-sm text-gray-500 py-4">טוען היסטוריה...</p>
            ) : (
              <div className="overflow-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">גרסה</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">שם</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">סטטוס</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">תאריך יצירה</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">תאריך הפעלה</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">נוצר על ידי</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(historyData?.history ?? []).map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700">v{row.version}</td>
                        <td className="px-4 py-2.5 text-gray-900">{row.name}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(row.created_at)}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(row.activated_at)}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs font-mono">
                          {row.created_by ? row.created_by.slice(0, 8) + "…" : "מערכת"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DialogContent>
        </Dialog>

      </div>
    </Shell>
  );
}
