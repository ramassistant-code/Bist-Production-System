import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Eye, Phone, Mail, Building2, User, Search, X } from "lucide-react";

import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

import {
  useListCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  getListCustomersQueryKey,
} from "@workspace/api-client-react";
import type { Customer } from "@workspace/api-client-react";

// ---------- helpers ----------

function formatDate(val: string | null | undefined): string {
  if (!val) return "—";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatCurrency(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return val;
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function empty(val: string | null | undefined): string {
  return val?.trim() ? val.trim() : "—";
}

// ---------- form schema ----------

const customerFormSchema = z.object({
  name: z.string().min(1, "שם הלקוח הוא שדה חובה"),
  phone: z.string().nullable().optional(),
  email: z
    .string()
    .email("כתובת אימייל אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  joined_at: z.string().nullable().optional(),
  birthday: z.string().nullable().optional(),
  invoice_name: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  invoice_email: z
    .string()
    .email("כתובת אימייל לחשבוניות אינה תקינה")
    .or(z.literal(""))
    .nullable()
    .optional(),
  customer_type: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  pain_points: z.string().nullable().optional(),
});

type CustomerFormValues = z.infer<typeof customerFormSchema>;

function toFormValues(c?: Customer): CustomerFormValues {
  return {
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    joined_at: c?.joined_at ?? "",
    birthday: c?.birthday ?? "",
    invoice_name: c?.invoice_name ?? "",
    tax_id: c?.tax_id ?? "",
    invoice_email: c?.invoice_email ?? "",
    customer_type: c?.customer_type ?? "",
    industry: c?.industry ?? "",
    pain_points: c?.pain_points ?? "",
  };
}

// sanitize: turn empty strings to null before sending to API
function sanitizeValues(vals: CustomerFormValues) {
  return Object.fromEntries(
    Object.entries(vals).map(([k, v]) => [k, v === "" ? null : v]),
  ) as CustomerFormValues;
}

// ---------- CustomerForm ----------

interface CustomerFormProps {
  defaultValues?: CustomerFormValues;
  onSubmit: (values: CustomerFormValues) => void;
  isLoading: boolean;
  onCancel: () => void;
}

function CustomerForm({ defaultValues, onSubmit, isLoading, onCancel }: CustomerFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: defaultValues ?? toFormValues(),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" dir="rtl">
      {/* Name */}
      <div className="space-y-1">
        <Label htmlFor="name">
          שם הלקוח <span className="text-destructive">*</span>
        </Label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="phone">טלפון</Label>
          <Input id="phone" {...register("phone")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">אימייל</Label>
          <Input id="email" type="email" {...register("email")} />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="customer_type">סוג לקוח</Label>
          <Input id="customer_type" {...register("customer_type")} placeholder="למשל: עסקי, פרטי" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="industry">תחום עיסוק</Label>
          <Input id="industry" {...register("industry")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="joined_at">תאריך הצטרפות</Label>
          <Input id="joined_at" type="date" {...register("joined_at")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="birthday">תאריך לידה</Label>
          <Input id="birthday" type="date" {...register("birthday")} />
        </div>
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">פרטי חשבוניות</p>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="invoice_name">שם לחשבונית</Label>
          <Input id="invoice_name" {...register("invoice_name")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax_id">מספר עוסק / ח.פ.</Label>
          <Input id="tax_id" {...register("tax_id")} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="invoice_email">אימייל לחשבוניות</Label>
        <Input id="invoice_email" type="email" {...register("invoice_email")} />
        {errors.invoice_email && (
          <p className="text-sm text-destructive">{errors.invoice_email.message}</p>
        )}
      </div>

      <Separator />
      <p className="text-sm font-medium text-muted-foreground">מידע נוסף</p>

      <div className="space-y-1">
        <Label htmlFor="pain_points">צרכים / נקודות כאב</Label>
        <Textarea id="pain_points" {...register("pain_points")} rows={3} />
      </div>

      <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "שומר..." : "שמירה"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          ביטול
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------- CustomerDetails ----------

interface CustomerDetailsProps {
  customer: Customer;
}

function CustomerDetails({ customer }: CustomerDetailsProps) {
  const mondayRaw = customer.monday_raw_data
    ? JSON.stringify(customer.monday_raw_data, null, 2)
    : null;

  const rows: { label: string; value: string }[] = [
    { label: "מזהה (ID)", value: customer.id },
    { label: "מספר לקוח", value: customer.customer_number },
    { label: "שם", value: customer.name },
    { label: "טלפון", value: empty(customer.phone) },
    { label: "אימייל", value: empty(customer.email) },
    { label: "סוג לקוח", value: empty(customer.customer_type) },
    { label: "תחום עיסוק", value: empty(customer.industry) },
    { label: "תאריך הצטרפות", value: formatDate(customer.joined_at) },
    { label: "תאריך לידה", value: formatDate(customer.birthday) },
    { label: "שם לחשבונית", value: empty(customer.invoice_name) },
    { label: "מספר עוסק / ח.פ.", value: empty(customer.tax_id) },
    { label: "אימייל לחשבוניות", value: empty(customer.invoice_email) },
    { label: "צרכים / נקודות כאב", value: empty(customer.pain_points) },
    { label: "מחזור עסקאות (LTV)", value: formatCurrency(customer.ltv_amount) },
    { label: "צבר עסקאות (לפני מע״מ)", value: formatCurrency(customer.pipeline_amount_ex_vat) },
    { label: "מנהל תיק (ID)", value: empty(customer.account_manager_id) },
    { label: "סטטוס יצירת קשר", value: empty(customer.account_manager_contact_status) },
    { label: "תאריך יצירת קשר", value: formatDate(customer.account_manager_contact_date) },
    { label: "ליד מקושר (ID)", value: empty(customer.lead_id) },
    { label: "Monday - לוח", value: empty(customer.monday_board_id) },
    { label: "Monday - פריט", value: empty(customer.monday_item_id) },
    { label: "Monday - קבוצה", value: empty(customer.monday_group_id) },
    { label: "Monday - נתונים גולמיים", value: mondayRaw ? mondayRaw.slice(0, 120) + (mondayRaw.length > 120 ? "…" : "") : "—" },
    { label: "נוצר ב", value: formatDate(customer.created_at) },
    { label: "עודכן ב", value: formatDate(customer.updated_at) },
    { label: "נמחק ב", value: formatDate(customer.deleted_at) },
  ];

  return (
    <div className="divide-y divide-border/50" dir="rtl">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between py-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium text-right max-w-[60%] break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Main Page ----------

export default function Customers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [detailsCustomer, setDetailsCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");

  const { data: customers, isLoading, isError } = useListCustomers();

  const filteredCustomers = customers?.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.customer_number ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.customer_type ?? "").toLowerCase().includes(q)
    );
  }) ?? [];

  const createMutation = useCreateCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setCreateOpen(false);
        toast({ title: "הלקוח נוצר בהצלחה" });
      },
      onError: (err: Error & { data?: { error?: string } }) => {
        const msg = err?.data?.error ?? "שגיאה ביצירת הלקוח";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateCustomer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setEditCustomer(null);
        toast({ title: "הלקוח עודכן בהצלחה" });
      },
      onError: (err: Error & { data?: { error?: string } }) => {
        const msg = err?.data?.error ?? "שגיאה בעדכון הלקוח";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  function handleCreate(values: CustomerFormValues) {
    createMutation.mutate({ data: sanitizeValues(values) });
  }

  function handleEdit(values: CustomerFormValues) {
    if (!editCustomer) return;
    updateMutation.mutate({ id: editCustomer.id, data: sanitizeValues(values) });
  }

  return (
    <Shell title="לקוחות">
      <div className="flex flex-col h-full">
        {/* Top controls */}
        <div className="shrink-0 flex items-center gap-3 px-8 pt-6 pb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, טלפון, אימייל..."
              className="w-full border border-border rounded-lg pr-9 pl-8 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground whitespace-nowrap">
            {!isLoading && !isError && customers
              ? search.trim()
                ? `${filteredCustomers.length} מתוך ${customers.length}`
                : `${customers.length} לקוחות`
              : ""}
          </p>
          <Button onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="w-4 h-4 ml-1" />
            לקוח חדש
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-8 pb-6">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">טוען לקוחות...</span>
              </div>
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-8 text-center">
                <p className="text-sm text-destructive font-medium">שגיאה בטעינת הלקוחות. אנא נסו שנית.</p>
              </div>
            </div>
          )}

          {!isLoading && !isError && customers?.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState title="אין לקוחות להצגה" description="לחצו על 'לקוח חדש' להוספת הלקוח הראשון." />
            </div>
          )}

          {!isLoading && !isError && customers && customers.length > 0 && filteredCustomers.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <EmptyState title="לא נמצאו תוצאות" description={`לא נמצאו לקוחות התואמים את "${search}"`} />
            </div>
          )}

          {!isLoading && !isError && customers && filteredCustomers.length > 0 && (
            <div className="h-full overflow-y-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border/50">
                  <tr>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">מספר לקוח</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">שם</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">טלפון</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">אימייל</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">סוג לקוח</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden xl:table-cell">הצטרף</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {customer.customer_number}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User className="w-3.5 h-3.5 text-primary" />
                          </div>
                          {customer.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {customer.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {customer.phone}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                        {customer.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {customer.email}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {customer.customer_type ? (
                          <Badge variant="outline">{customer.customer_type}</Badge>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">
                        {formatDate(customer.joined_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => setDetailsCustomer(customer)} title="פרטים">
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditCustomer(customer)} title="עריכה">
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>לקוח חדש</DialogTitle>
          </DialogHeader>
          <CustomerForm
            onSubmit={handleCreate}
            isLoading={createMutation.isPending}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(open) => !open && setEditCustomer(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת לקוח — {editCustomer?.name}</DialogTitle>
          </DialogHeader>
          {editCustomer && (
            <CustomerForm
              key={editCustomer.id}
              defaultValues={toFormValues(editCustomer)}
              onSubmit={handleEdit}
              isLoading={updateMutation.isPending}
              onCancel={() => setEditCustomer(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <Dialog open={!!detailsCustomer} onOpenChange={(open) => !open && setDetailsCustomer(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {detailsCustomer?.name}
            </DialogTitle>
          </DialogHeader>
          {detailsCustomer && <CustomerDetails customer={detailsCustomer} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDetailsCustomer(null);
                setEditCustomer(detailsCustomer);
              }}
            >
              <Pencil className="w-3.5 h-3.5 ml-1" />
              עריכה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
