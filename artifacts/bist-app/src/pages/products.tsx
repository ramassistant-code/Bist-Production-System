import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, PackagePlus, X } from "lucide-react";

import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useGetProduct,
  useAddProductComponent,
  useRemoveProductComponent,
  useListComponents,
  getListProductsQueryKey,
  getGetProductQueryKey,
} from "@workspace/api-client-react";
import type { Product, ProductWithComponents, ProductComponentRow } from "@workspace/api-client-react";

// ---------- helpers ----------

function formatCurrency(val: string | null | undefined): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function empty(val: string | null | undefined): string {
  return val?.trim() ? val.trim() : "—";
}

// ---------- form schema ----------

const productFormSchema = z.object({
  name: z.string().min(1, "שם המוצר הוא שדה חובה"),
  category: z.string().nullable().optional(),
  deliverable_type: z.string().nullable().optional(),
  consumer_price: z.string().nullable().optional(),
  product_explanation: z.string().nullable().optional(),
  sales_notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

function toFormValues(p?: Product | ProductWithComponents): ProductFormValues {
  return {
    name: p?.name ?? "",
    category: p?.category ?? "",
    deliverable_type: p?.deliverable_type ?? "",
    consumer_price: p?.consumer_price ?? "",
    product_explanation: p?.product_explanation ?? "",
    sales_notes: p?.sales_notes ?? "",
    is_active: p?.is_active ?? true,
  };
}

function sanitize(v: ProductFormValues): Record<string, unknown> {
  return {
    name: v.name,
    category: v.category?.trim() || null,
    deliverable_type: v.deliverable_type?.trim() || null,
    consumer_price: v.consumer_price?.trim() || null,
    product_explanation: v.product_explanation?.trim() || null,
    sales_notes: v.sales_notes?.trim() || null,
    is_active: v.is_active ?? true,
  };
}

// ---------- product fields form ----------

interface ProductFieldsFormProps {
  defaultValues: ProductFormValues;
  onSubmit: (values: ProductFormValues) => void;
  isPending: boolean;
  submitLabel: string;
}

function ProductFieldsForm({ defaultValues, onSubmit, isPending, submitLabel }: ProductFieldsFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({ resolver: zodResolver(productFormSchema), defaultValues });

  const isActive = watch("is_active");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="name">שם המוצר *</Label>
        <Input id="name" {...register("name")} className="mt-1" dir="rtl" />
        {errors.name && <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="category">קטגוריה</Label>
          <Input id="category" {...register("category")} className="mt-1" dir="rtl" />
        </div>
        <div>
          <Label htmlFor="deliverable_type">סוג תוצר</Label>
          <Input id="deliverable_type" {...register("deliverable_type")} className="mt-1" dir="rtl" />
        </div>
      </div>

      <div>
        <Label htmlFor="consumer_price">מחיר מכירה (₪)</Label>
        <Input
          id="consumer_price"
          {...register("consumer_price")}
          className="mt-1 text-left"
          dir="ltr"
          placeholder="0"
          type="number"
          step="0.01"
        />
      </div>

      <div>
        <Label htmlFor="product_explanation">תיאור המוצר</Label>
        <Textarea id="product_explanation" {...register("product_explanation")} className="mt-1" dir="rtl" rows={3} />
      </div>

      <div>
        <Label htmlFor="sales_notes">הערות פנימיות</Label>
        <Textarea id="sales_notes" {...register("sales_notes")} className="mt-1" dir="rtl" rows={2} />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          checked={isActive ?? true}
          onChange={(e) => setValue("is_active", e.target.checked)}
          className="w-4 h-4"
        />
        <Label htmlFor="is_active">מוצר פעיל</Label>
      </div>

      <div className="pt-1">
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "שומר..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------- inline add-component row ----------

interface AddComponentRowProps {
  productId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddComponentRow({ productId, onAdded, onCancel }: AddComponentRowProps) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const { data: allComponents } = useListComponents({});
  const addMutation = useAddProductComponent();

  const active = (allComponents ?? []).filter((c) => c.is_active !== false);
  const selectedComp = active.find((c) => c.id === selectedId);

  const previewTotal =
    selectedComp && quantity
      ? parseFloat(quantity || "1") * parseFloat(unitPrice || selectedComp.cost || "0")
      : null;

  function handleAdd() {
    if (!selectedId) {
      toast({ title: "יש לבחור רכיב", variant: "destructive" });
      return;
    }
    addMutation.mutate(
      {
        id: productId,
        data: {
          component_id: selectedId,
          default_quantity: quantity || "1",
          default_unit_price: unitPrice || selectedComp?.cost || "0",
        },
      },
      {
        onSuccess: () => {
          toast({ title: "הרכיב נוסף" });
          onAdded();
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "שגיאה בהוספת הרכיב";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  return (
    <tr className="border-t bg-blue-50/50">
      <td className="py-2 px-3" colSpan={4}>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-xs mb-1 block">רכיב</Label>
            <select
              className="w-full border rounded-md px-2 py-1.5 text-sm bg-card"
              dir="rtl"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                const c = active.find((x) => x.id === e.target.value);
                setUnitPrice(c?.cost ?? "");
              }}
            >
              <option value="">— בחר רכיב —</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.component_number} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <Label className="text-xs mb-1 block">כמות</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-8 text-left text-sm"
              dir="ltr"
            />
          </div>
          <div className="w-28">
            <Label className="text-xs mb-1 block">עלות ₪</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder={selectedComp?.cost ?? "0"}
              className="h-8 text-left text-sm"
              dir="ltr"
            />
          </div>
          {previewTotal !== null && !isNaN(previewTotal) && (
            <div className="text-sm font-medium text-green-700 pt-4">
              = {formatCurrency(String(previewTotal))}
            </div>
          )}
          <div className="flex gap-1 pt-4">
            <Button size="sm" onClick={handleAdd} disabled={addMutation.isPending}>
              {addMutation.isPending ? "..." : "הוסף"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </td>
      <td />
    </tr>
  );
}

// ---------- unified product modal (create + edit + components) ----------

interface ProductModalProps {
  /** null = create mode; string = edit mode (product ID) */
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** called after a new product is saved, with the new product's ID */
  onCreated?: (id: string) => void;
}

function ProductModal({ productId, open, onOpenChange, onCreated }: ProductModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddRow, setShowAddRow] = useState(false);

  const isEdit = !!productId;

  // Fetch product data in edit mode
  const { data: productData, isLoading } = useGetProduct(productId ?? "", {
    query: {
      enabled: isEdit && open,
      queryKey: getGetProductQueryKey(productId ?? ""),
    },
  });

  const pw = productData as ProductWithComponents | undefined;

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const removeMutation = useRemoveProductComponent();

  function handleSubmit(values: ProductFormValues) {
    if (isEdit) {
      updateMutation.mutate(
        {
          id: productId!,
          data: sanitize(values) as unknown as Parameters<typeof updateMutation.mutate>[0]["data"],
        },
        {
          onSuccess: () => {
            toast({ title: "המוצר עודכן בהצלחה" });
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId!) });
          },
          onError: (err: unknown) => {
            const msg =
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "שגיאה בעדכון המוצר";
            toast({ title: msg, variant: "destructive" });
          },
        }
      );
    } else {
      createMutation.mutate(
        { data: sanitize(values) as unknown as Parameters<typeof createMutation.mutate>[0]["data"] },
        {
          onSuccess: (newProduct) => {
            toast({ title: "המוצר נוצר — ניתן כעת להוסיף רכיבים" });
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            onCreated?.((newProduct as Product).id);
          },
          onError: (err: unknown) => {
            const msg =
              (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
              "שגיאה ביצירת המוצר";
            toast({ title: msg, variant: "destructive" });
          },
        }
      );
    }
  }

  function handleRemoveComponent(pcId: string) {
    if (!productId) return;
    removeMutation.mutate(
      { id: productId, pcId },
      {
        onSuccess: () => {
          toast({ title: "הרכיב הוסר" });
          queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
        },
        onError: () => toast({ title: "שגיאה בהסרת הרכיב", variant: "destructive" }),
      }
    );
  }

  const title = isEdit
    ? `עריכת מוצר${pw ? ` — ${pw.name}` : ""}`
    : "מוצר חדש";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{title}</span>
            {pw && (
              <>
                <span className="text-sm font-normal text-muted-foreground">{pw.product_number}</span>
                <Badge variant={pw.is_active !== false ? "default" : "secondary"}>
                  {pw.is_active !== false ? "פעיל" : "לא פעיל"}
                </Badge>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {isEdit && isLoading ? (
          <div className="py-16 text-center text-muted-foreground">טוען...</div>
        ) : (
          <div className="space-y-6">
            {/* ---- product fields ---- */}
            <ProductFieldsForm
              key={productId ?? "create"}
              defaultValues={toFormValues(pw)}
              onSubmit={handleSubmit}
              isPending={isEdit ? updateMutation.isPending : createMutation.isPending}
              submitLabel={isEdit ? "שמור שינויים" : "צור מוצר והמשך לרכיבים"}
            />

            {/* ---- components section — only in edit mode ---- */}
            {isEdit && (
              <>
                <Separator />

                <div>
                  {/* summary row */}
                  {pw && pw.consumer_price && pw.calculated_cost && (
                    <div className="flex gap-6 text-sm mb-4 bg-muted/30 rounded-lg px-4 py-2">
                      <div>
                        <span className="text-muted-foreground">מחיר מכירה: </span>
                        <span className="font-semibold">{formatCurrency(pw.consumer_price)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">עלות מחושבת: </span>
                        <span className="font-semibold">{formatCurrency(pw.calculated_cost)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">רווח גולמי: </span>
                        <span className="font-semibold text-green-700">
                          {formatCurrency(
                            String(parseFloat(pw.consumer_price) - parseFloat(pw.calculated_cost))
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-base">
                      רכיבים ({pw?.components?.length ?? 0})
                    </h3>
                    {!showAddRow && (
                      <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
                        <PackagePlus className="w-4 h-4 ml-1" />
                        שייך רכיב
                      </Button>
                    )}
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-right py-2 px-3 font-medium">רכיב</th>
                          <th className="text-center py-2 px-3 font-medium w-20">כמות</th>
                          <th className="text-center py-2 px-3 font-medium w-28">עלות ליחידה</th>
                          <th className="text-center py-2 px-3 font-medium w-24">סה״כ</th>
                          <th className="py-2 px-3 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {(!pw?.components?.length && !showAddRow) && (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                              טרם שויכו רכיבים למוצר זה — לחץ על "שייך רכיב"
                            </td>
                          </tr>
                        )}
                        {(pw?.components as ProductComponentRow[] | undefined)?.map((pc) => (
                          <tr key={pc.id} className="border-t hover:bg-muted/20">
                            <td className="py-2 px-3">
                              <div className="font-medium">{pc.component_name ?? "—"}</div>
                              {pc.component_deliverable && (
                                <div className="text-xs text-muted-foreground">{pc.component_deliverable}</div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">{pc.default_quantity ?? "1"}</td>
                            <td className="py-2 px-3 text-center">{formatCurrency(pc.default_unit_price)}</td>
                            <td className="py-2 px-3 text-center font-medium">{formatCurrency(pc.total_cost)}</td>
                            <td className="py-2 px-3 text-center">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="w-7 h-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleRemoveComponent(pc.id)}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}

                        {/* inline add row */}
                        {showAddRow && (
                          <AddComponentRow
                            productId={productId!}
                            onAdded={() => {
                              setShowAddRow(false);
                              queryClient.invalidateQueries({
                                queryKey: getGetProductQueryKey(productId!),
                              });
                            }}
                            onCancel={() => setShowAddRow(false)}
                          />
                        )}
                      </tbody>

                      {pw?.calculated_cost && parseFloat(pw.calculated_cost) > 0 && (
                        <tfoot className="bg-muted/30 border-t">
                          <tr>
                            <td colSpan={3} className="py-2 px-3 text-right font-semibold">
                              סה״כ עלות:
                            </td>
                            <td className="py-2 px-3 text-center font-bold">
                              {formatCurrency(pw.calculated_cost)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* hint for create mode */}
            {!isEdit && (
              <p className="text-xs text-muted-foreground text-center">
                לאחר יצירת המוצר תוכל לשייך אליו רכיבים
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- main page ----------

export default function Products() {
  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  // Single modal state: null = closed, "" = create mode, "uuid" = edit mode
  const [modalProductId, setModalProductId] = useState<string | null>(null);
  const modalOpen = modalProductId !== null;

  const queryParams = {
    ...(filterActive === "active" ? { is_active: true } : {}),
    ...(filterActive === "inactive" ? { is_active: false } : {}),
  };

  const { data: products, isLoading } = useListProducts(queryParams);

  const filtered = (products ?? []).filter(
    (p) =>
      !search ||
      p.name.includes(search) ||
      (p.category ?? "").includes(search)
  );

  function openCreate() {
    setModalProductId(""); // empty string = create mode
  }

  function openEdit(id: string) {
    setModalProductId(id);
  }

  function closeModal() {
    setModalProductId(null);
  }

  return (
    <Shell title="מוצרים">
      <div className="flex flex-col h-full">
        {/* Top controls */}
        <div className="shrink-0 px-8 pt-6 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="חיפוש לפי שם או קטגוריה..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
                dir="rtl"
              />
              <select
                className="border rounded-md px-3 py-2 text-sm bg-background"
                value={filterActive}
                onChange={(e) => setFilterActive(e.target.value as typeof filterActive)}
                dir="rtl"
              >
                <option value="all">כל המוצרים</option>
                <option value="active">פעילים בלבד</option>
                <option value="inactive">לא פעילים</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              {!isLoading && !!filtered.length && (
                <span className="text-sm text-muted-foreground">{filtered.length} מוצרים</span>
              )}
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 ml-1" />
                מוצר חדש
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-8 pb-6">
          {isLoading && (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">טוען מוצרים...</span>
              </div>
            </div>
          )}

          {!isLoading && !filtered.length && (
            <div className="flex items-center justify-center h-full">
              <EmptyState
                title={search ? "לא נמצאו מוצרים תואמים" : "אין מוצרים להצגה"}
                description={search ? "נסה חיפוש אחר" : "לחץ על 'מוצר חדש' להוספת מוצר ראשון"}
              />
            </div>
          )}

          {!isLoading && filtered.length > 0 && (
            <div className="h-full overflow-y-auto bg-card rounded-xl border shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/40 border-b">
                  <tr>
                    <th className="text-right py-3 px-4 font-semibold">מספר</th>
                    <th className="text-right py-3 px-4 font-semibold">שם המוצר</th>
                    <th className="text-right py-3 px-4 font-semibold">קטגוריה</th>
                    <th className="text-right py-3 px-4 font-semibold">מחיר מכירה</th>
                    <th className="text-right py-3 px-4 font-semibold">סטטוס</th>
                    <th className="py-3 px-4 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => openEdit(p.id)}
                    >
                      <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{p.product_number}</td>
                      <td className="py-3 px-4 font-medium">{p.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{empty(p.category)}</td>
                      <td className="py-3 px-4">{formatCurrency(p.consumer_price)}</td>
                      <td className="py-3 px-4">
                        <Badge variant={p.is_active !== false ? "default" : "secondary"}>
                          {p.is_active !== false ? "פעיל" : "לא פעיל"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" className="w-8 h-8" onClick={() => openEdit(p.id)} title="עריכה ורכיבים">
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Unified product modal */}
      <ProductModal
        productId={modalProductId === "" ? null : modalProductId}
        open={modalOpen}
        onOpenChange={(open) => !open && closeModal()}
        onCreated={(newId) => {
          // transition from create to edit mode to show component section
          setModalProductId(newId);
        }}
      />
    </Shell>
  );
}
