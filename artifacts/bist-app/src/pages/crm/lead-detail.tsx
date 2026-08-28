import { Link, useRoute } from "wouter";
import {
  getGetCrmLeadContextQueryKey,
  getGetCrmLeadQueryKey,
  getListCrmLeadStatusesQueryKey,
  useGetCrmLead,
  useGetCrmLeadContext,
  useListCrmLeadStatuses,
} from "@workspace/api-client-react";
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Clock,
  FileText,
  Handshake,
  Loader2,
  Mail,
  MapPin,
  Phone,
  PhoneCall,
  UserRound,
} from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCrmView } from "./use-crm-view";
import { useActiveSalesUsers } from "./use-users";
import { crmCurrency, crmDate, crmEmpty } from "./format";

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export default function CrmLeadDetail() {
  const [, params] = useRoute("/crm/leads/:id");
  const id = params?.id ?? "";
  const { view } = useCrmView();
  const { data: reps } = useActiveSalesUsers();

  const leadQuery = useGetCrmLead(id, { view }, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetCrmLeadQueryKey(id, { view }),
    },
  });
  const contextQuery = useGetCrmLeadContext(id, { view }, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetCrmLeadContextQueryKey(id, { view }),
    },
  });
  // התוויות של הסטטוסים חיות ב-crm_lead_statuses. אין מפה קשיחה בקוד —
  // אדמין שמוסיף סטטוס לא אמור לחייב deploy.
  const { data: statuses } = useListCrmLeadStatuses({ view }, {
    query: {
      queryKey: getListCrmLeadStatusesQueryKey({ view }),
    },
  });

  if (leadQuery.isLoading || contextQuery.isLoading) {
    return (
      <Shell title="פרטי ליד">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Shell>
    );
  }

  const missing =
    isNotFound(leadQuery.error) ||
    isNotFound(contextQuery.error) ||
    (!leadQuery.isError && !leadQuery.data) ||
    (!contextQuery.isError && !contextQuery.data);
  if (missing) {
    return (
      <Shell title="פרטי ליד">
        <div
          className="flex h-64 flex-col items-center justify-center rounded-xl border border-border bg-card"
          data-testid="status-crm-lead-not-found"
        >
          <h2 className="mb-4 text-xl font-bold">הליד לא נמצא</h2>
          <Button asChild>
            <Link href="/crm/leads" data-testid="link-crm-leads-from-not-found">
              חזרה לרשימת הלידים
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (leadQuery.isError || contextQuery.isError) {
    return (
      <Shell title="פרטי ליד">
        <div
          className="flex h-64 flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5"
          data-testid="status-crm-lead-error"
        >
          <p className="text-sm text-destructive">שגיאה בטעינת פרטי הליד</p>
          <Button variant="outline" asChild>
            <Link href="/crm/leads" data-testid="link-crm-leads-from-error">
              חזרה לרשימת הלידים
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  const lead = leadQuery.data!;
  const context = contextQuery.data!;
  const rep = reps?.find((user) => user.id === lead.sales_rep_id);
  const latestInquiry = context.inquiries[0];

  return (
    <Shell title="פרטי ליד">
      <div className="mx-auto max-w-6xl space-y-6 pb-16">
        <Button variant="outline" size="sm" asChild>
          <Link href="/crm/leads" className="gap-2" data-testid="link-crm-leads">
            <ArrowRight className="h-4 w-4" />
            חזרה ללידים
          </Link>
        </Button>

        <Card data-testid="card-crm-lead-header">
          <CardContent className="flex flex-col gap-5 pt-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2
                className="text-2xl font-bold"
                data-testid="text-crm-lead-name"
              >
                {lead.name}
              </h2>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-2" dir="ltr">
                  <Phone className="h-4 w-4" />
                  {crmEmpty(lead.phone_e164 || lead.phone_raw)}
                </span>
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {crmEmpty(lead.email)}
                </span>
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4" />
                  {rep?.full_name || rep?.email || "לא הוקצה"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" data-testid="badge-crm-lead-status">
                {statuses?.find((status) => status.code === lead.status_code)
                  ?.label ?? lead.status_code}
              </Badge>
              {lead.is_active_customer && (
                <Badge variant="success">לקוח פעיל</Badge>
              )}
              {lead.pending_reassignment && (
                <Badge variant="warning">ממתין לשיוך</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="section-crm-lead-source">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-primary" />
              מקור הפנייה
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="מקור" value={lead.source} />
            <Detail label="אסמכתא / קמפיין" value={lead.source_ref} />
            <Detail label="משפך אחרון" value={latestInquiry?.funnel_name} />
            <Detail label="מודעה אחרונה" value={latestInquiry?.ad_name} />
            <Detail
              label="תאריך יצירה"
              value={crmDate(lead.created_at, true)}
            />
            <Detail label="סטטוס מענה" value={lead.answer_status} />
          </CardContent>
        </Card>

        <Section
          icon={<Clock className="h-4 w-4 text-primary" />}
          title={`היסטוריית פניות (${context.inquiries.length})`}
          testId="section-crm-lead-inquiries"
        >
          {context.inquiries.length === 0 ? (
            <EmptyLine text="אין פניות מתועדות" />
          ) : (
            <div className="space-y-3">
              {context.inquiries.map((inquiry) => (
                <div
                  key={inquiry.id}
                  className="rounded-lg border border-border bg-muted/40 p-4 text-sm"
                  data-testid={`card-crm-inquiry-${inquiry.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>פנייה מספר {inquiry.inquiry_number}</strong>
                    <span className="text-xs text-muted-foreground">
                      {crmDate(inquiry.inquiry_at, true)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Detail label="משפך" value={inquiry.funnel_name} />
                    <Detail label="מודעה" value={inquiry.ad_name} />
                    <Detail label="מקור" value={inquiry.source} />
                    <Detail label="טופס" value={inquiry.form_name} />
                  </div>
                  {inquiry.free_text && (
                    <p className="mt-3 whitespace-pre-wrap rounded-md bg-background p-3 text-muted-foreground">
                      {inquiry.free_text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<PhoneCall className="h-4 w-4 text-primary" />}
          title={`שיחות (${context.call_logs.length})`}
          testId="section-crm-lead-calls"
        >
          {context.call_logs.length === 0 ? (
            <EmptyLine text="אין שיחות מתועדות" />
          ) : (
            <div className="space-y-3">
              {context.call_logs.map((call) => (
                <div
                  key={call.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm"
                >
                  <div>
                    <strong>
                      {call.direction === "inbound"
                        ? "שיחה נכנסת"
                        : "שיחה יוצאת"}
                    </strong>
                    <span className="mx-2 text-muted-foreground">
                      {crmEmpty(call.result)}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {crmDate(call.started_at, true)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.floor(call.duration_sec / 60)}:
                    {(call.duration_sec % 60).toString().padStart(2, "0")} דקות
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<FileText className="h-4 w-4 text-primary" />}
          title={`הערות (${context.notes.length})`}
          testId="section-crm-lead-notes"
        >
          {context.notes.length === 0 ? (
            <EmptyLine text="אין הערות" />
          ) : (
            <div className="space-y-3">
              {context.notes.map((note) => (
                <div key={note.id} className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="mb-1 text-xs text-muted-foreground">
                    {crmDate(note.created_at, true)}
                  </p>
                  <p className="whitespace-pre-wrap">{note.content}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
          title={`משימות (${context.tasks.length})`}
          testId="section-crm-lead-tasks"
        >
          {context.tasks.length === 0 ? (
            <EmptyLine text="אין משימות" />
          ) : (
            <div className="space-y-3">
              {context.tasks.map((task) => (
                <div key={task.id} className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong>{task.title}</strong>
                    <Badge
                      variant={task.status === "completed" ? "success" : "secondary"}
                    >
                      {task.status === "completed" ? "הושלמה" : task.status}
                    </Badge>
                  </div>
                  {task.description && (
                    <p className="mt-2 text-muted-foreground">{task.description}</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    תאריך יעד: {crmDate(task.due_at, true)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<Handshake className="h-4 w-4 text-primary" />}
          title={`עסקאות ותשלומים (${context.deals.length})`}
          testId="section-crm-lead-deals"
        >
          {context.deals.length === 0 ? (
            <EmptyLine text="אין עסקאות" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {context.deals.map((deal, index) => {
                const row = asRecord(deal);
                const payments = Array.isArray(deal.payments) ? deal.payments : [];
                // הסכום נקרא מהעסקה כמו שהוא. ה-CRM לא מחשב כסף ולא מסכם
                // תשלומים — ההגדרה יושבת ב-services/crm/legacy-read.ts בלבד.
                const amount = row.total_amount_including_vat ?? row.total_amount;
                return (
                  <div
                    key={String(row.id ?? index)}
                    className="rounded-lg border bg-muted/40 p-4"
                    data-testid={`card-crm-deal-${String(row.id ?? index)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>
                        {crmEmpty(row.deal_number ?? row.name ?? `עסקה ${index + 1}`)}
                      </strong>
                      <Badge variant="outline">{payments.length} תשלומים</Badge>
                    </div>
                    <p
                      className={
                        deal.amounts_trustworthy
                          ? "mt-3 text-lg font-bold text-primary"
                          : "mt-3 text-lg font-bold text-muted-foreground"
                      }
                    >
                      {crmCurrency(amount)}
                    </p>
                    {!deal.amounts_trustworthy && (
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        סכום לא מאומת — מקורו במנדיי
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          icon={<Box className="h-4 w-4 text-primary" />}
          title={`מוצרים (${context.products.length})`}
          testId="section-crm-lead-products"
        >
          {context.products.length === 0 ? (
            <EmptyLine text="אין מוצרים" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {context.products.map((product) => (
                <div key={product.id} className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <strong>{product.name}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {crmEmpty(product.category)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Shell>
  );
}

function Detail({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{crmEmpty(value)}</p>
    </div>
  );
}

function Section({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}