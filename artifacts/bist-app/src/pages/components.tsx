import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye } from "lucide-react";

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
import { useToast } from "@/hooks/use-toast";

import {
  useListComponents,
  useCreateComponent,
  useUpdateComponent,
  getListComponentsQueryKey,
} from "@workspace/api-client-react";
import type { Component } from "@workspace/api-client-react";

// ---------- component form ----------

const componentFormSchema = z.object({
  name: z.string().min(1, "שם הרכיב הוא שדה חובה"),
  quote_description_default: z.string().nullable().optional(),
  quote_notes_default: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

type ComponentFormValues = z.infer<typeof componentFormSchema>;

function toFormValues(c?: Component): ComponentFormValues {
  return {
    name: c?.name ?? "",
    quote_description_default: c?.quote_description_default ?? "",
    quote_notes_default: c?.quote_notes_default ?? "",
    is_active: c?.is_active ?? true,
  };
}

function sanitize(v: ComponentFormValues): Record<string, unknown> {
  return {
    name: v.name,
    quote_description_default: v.quote_description_default?.trim() || null,
    quote_notes_default: v.quote_notes_default?.trim() || null,
    is_active: v.is_active ?? true,
  };
}

// ---------- component form component ----------

interface ComponentFormProps {
  defaultValues: ComponentFormValues;
  onSubmit: (values: ComponentFormValues) => void;
  isPending: boolean;
  submitLabel: string;
  viewOnly?: boolean;
}

function ComponentForm({ defaultValues, onSubmit, isPending, submitLabel, viewOnly }: ComponentFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ComponentFormValues>({ resolver: zodResolver(componentFormSchema), defaultValues });

  const isActive = watch("is_active");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-2">
      <div>
        <Label htmlFor="name">שם הרכיב *</Label>
        <Input
          id="name"
          {...register("name")}
          className="mt-1"
          dir="rtl"
          readOnly={viewOnly}
        />
        {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <Label htmlFor="quote_description_default">תיאור רכיב ברמת הצעת מחיר</Label>
        <Textarea
          id="quote_description_default"
          {...register("quote_description_default")}
          className="mt-1"
          dir="rtl"
          rows={3}
          readOnly={viewOnly}
        />
      </div>

      <div>
        <Label htmlFor="quote_notes_default">הערות לרכיב ברמת הצעת מחיר</Label>
        <Textarea
          id="quote_notes_default"
          {...register("quote_notes_default")}
          className="mt-1"
          dir="rtl"
          rows={3}
          readOnly={viewOnly}
        />
      </div>

      {!viewOnly && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_active"
            checked={isActive ?? true}
            onChange={(e) => setValue("is_active", e.target.checked)}
            className="w-4 h-4"
          />
          <Label htmlFor="is_active">רכיב פעיל</Label>
        </div>
      )}

      {!viewOnly && (
        <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button type="submit" disabled={isPending}>
            {isPending ? "שומר..." : submitLabel}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

// ---------- component details dialog ----------

interface ComponentDetailsProps {
  component: Component;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ComponentDetailsDialog({ component: c, open, onOpenChange }: ComponentDetailsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{c.name}</span>
            <span className="text-sm font-normal text-muted-foreground">{c.component_number}</span>
            <Badge variant={c.is_active !== false ? "default" : "secondary"}>
              {c.is_active !== false ? "פעיל" : "לא פעיל"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {c.quote_description_default && (
            <div>
              <p className="text-muted-foreground text-xs mb-1">תיאור רכיב ברמת הצעת מחיר</p>
              <p>{c.quote_description_default}</p>
            </div>
          )}

          {c.quote_notes_default && (
            <div>
              <p className="text-muted-foreground text-xs mb-1">הערות לרכיב ברמת הצעת מחיר</p>
              <p>{c.quote_notes_default}</p>
            </div>
          )}

          {!c.quote_description_default && !c.quote_notes_default && (
            <p className="text-muted-foreground text-xs">אין תיאור או הערות לרכיב זה.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- main page ----------

export default function Components() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editComponent, setEditComponent] = useState<Component | null>(null);
  const [detailsComponent, setDetailsComponent] = useState<Component | null>(null);

  const queryParams = {
    ...(filterActive === "active" ? { is_active: true } : {}),
    ...(filterActive === "inactive" ? { is_active: false } : {}),
  };

  const { data: components, isLoading } = useListComponents(queryParams);
  const createMutation = useCreateComponent();
  const updateMutation = useUpdateComponent();

  const allComponents = components ?? [];

  const searchLower = search.toLowerCase();
  const filtered = allComponents.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(searchLower) ||
      (c.component_number ?? "").toLowerCase().includes(searchLower)
  );

  function handleCreate(values: ComponentFormValues) {
    createMutation.mutate(
      { data: sanitize(values) as unknown as Parameters<typeof createMutation.mutate>[0]["data"] },
      {
        onSuccess: () => {
          toast({ title: "הרכיב נוצר בהצלחה" });
          queryClient.invalidateQueries({ queryKey: getListComponentsQueryKey() });
          setCreateOpen(false);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "שגיאה ביצירת הרכיב";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  function handleUpdate(values: ComponentFormValues) {
    if (!editComponent) return;
    updateMutation.mutate(
      {
        id: editComponent.id,
        data: sanitize(values) as unknown as Parameters<typeof updateMutation.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          toast({ title: "הרכיב עודכן בהצלחה" });
          queryClient.invalidateQueries({ queryKey: getListComponentsQueryKey() });
          setEditComponent(null);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "שגיאה בעדכון הרכיב";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  return (
    <Shell title="רכיבים">
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="חיפוש לפי שם או מספר..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
            dir="rtl"
          />
          <select
            className="border rounded-md px-3 py-2 text-sm bg-background"
            value={filterActive}
            onChange={(e) => setFilterActive(e.target.value as typeof filterActive)}
            dir="rtl"
          >
            <option value="all">כל הרכיבים</option>
            <option value="active">פעילים בלבד</option>
            <option value="inactive">לא פעילים</option>
          </select>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1 self-start sm:self-auto">
          + רכיב חדש
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-16">טוען רכיבים...</div>
      ) : !filtered.length ? (
        <EmptyState
          title={search ? "לא נמצאו רכיבים תואמים" : "אין רכיבים להצגה"}
          description={search ? "נסה חיפוש אחר" : "לא קיימים רכיבים במערכת."}
        />
      ) : (
        <div className="bg-card rounded-xl border overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-right py-3 px-4 font-semibold">מספר</th>
                <th className="text-right py-3 px-4 font-semibold">שם הרכיב</th>
                <th className="text-right py-3 px-4 font-semibold">תיאור להצעת מחיר</th>
                <th className="text-right py-3 px-4 font-semibold">סטטוס</th>
                <th className="py-3 px-4 w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                    {c.component_number}
                  </td>
                  <td className="py-3 px-4 font-medium">{c.name}</td>
                  <td className="py-3 px-4 text-muted-foreground max-w-xs truncate">
                    {c.quote_description_default ?? "—"}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={c.is_active !== false ? "default" : "secondary"}>
                      {c.is_active !== false ? "פעיל" : "לא פעיל"}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8"
                        onClick={() => setDetailsComponent(c)}
                        title="פרטים"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} רכיבים
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>רכיב חדש</DialogTitle>
          </DialogHeader>
          <ComponentForm
            defaultValues={toFormValues()}
            onSubmit={handleCreate}
            isPending={createMutation.isPending}
            submitLabel="צור רכיב"
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editComponent}
        onOpenChange={(open) => !open && setEditComponent(null)}
      >
        <DialogContent className="max-w-xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת רכיב — {editComponent?.name}</DialogTitle>
          </DialogHeader>
          {editComponent && (
            <ComponentForm
              key={editComponent.id}
              defaultValues={toFormValues(editComponent)}
              onSubmit={handleUpdate}
              isPending={updateMutation.isPending}
              submitLabel="שמור שינויים"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      {detailsComponent && (
        <ComponentDetailsDialog
          component={detailsComponent}
          open={!!detailsComponent}
          onOpenChange={(open) => !open && setDetailsComponent(null)}
        />
      )}
    </Shell>
  );
}
