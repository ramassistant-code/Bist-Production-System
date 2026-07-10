import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Eye, Trash2, PackagePlus } from "lucide-react";

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

// ---------- product form ----------

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

function toFormValues(p?: Product): ProductFormValues {
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

// ---------- product form component ----------

interface ProductFormProps {
  defaultValues: ProductFormValues;
  onSubmit: (values: ProductFormValues) => void;
  isPending: boolean;
  submitLabel: string;
}

function ProductForm({ defaultValues, onSubmit, isPending, submitLabel }: ProductFormProps) {
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
        <Textarea
          id="product_explanation"
          {...register("product_explanation")}
          className="mt-1"
          dir="rtl"
          rows={3}
        />
      </div>

      <div>
        <Label htmlFor="sales_notes">הערות פנימיות</Label>
        <Textarea
          id="sales_notes"
          {...register("sales_notes")}
          className="mt-1"
          dir="rtl"
          rows={2}
        />
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

      <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
        <Button type="submit" disabled={isPending}>
          {isPending ? "שומר..." : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------- add component modal ----------

interface AddComponentModalProps {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AddComponentModal({ productId, open, onOpenChange }: AddComponentModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const { data: components } = useListComponents({});
  const addMutation = useAddProductComponent();

  const activeComponents = (components ?? []).filter((c) => c.is_active !== false);

  function handleAdd() {
    if (!selectedComponentId) {
      toast({ title: "יש לבחור רכיב", variant: "destructive" });
      return;
    }
    const selectedComp = activeComponents.find((c) => c.id === selectedComponentId);
    const resolvedPrice = unitPrice || selectedComp?.cost || "0";

    addMutation.mutate(
      {
        id: productId,
        data: {
          component_id: selectedComponentId,
          default_quantity: quantity || "1",
          default_unit_price: resolvedPrice,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "הרכיב נוסף בהצלחה" });
          queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
          setSelectedComponentId("");
          setQuantity("1");
          setUnitPrice("");
          onOpenChange(false);
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

  const selectedComp = activeComponents.find((c) => c.id === selectedComponentId);
  const previewTotal =
    quantity && unitPrice
      ? parseFloat(quantity) * parseFloat(unitPrice)
      : selectedComp && quantity
      ? parseFloat(quantity) * parseFloat(selectedComp.cost ?? "0")
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוספת רכיב למוצר</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>רכיב</Label>
            <select
              className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
              dir="rtl"
              value={selectedComponentId}
              onChange={(e) => {
                setSelectedComponentId(e.target.value);
                const comp = activeComponents.find((c) => c.id === e.target.value);
                setUnitPrice(comp?.cost ?? "");
              }}
            >
              <option value="">— בחר רכיב —</option>
              {activeComponents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.component_number} — {c.name}
                </option>
              ))}
            </select>
          </div>

          {selectedComp && (
            <p className="text-xs text-muted-foreground">
              עלות ברירת מחדל: {formatCurrency(selectedComp.cost)}
              {selectedComp.deliverable ? ` | יחידה: ${selectedComp.deliverable}` : ""}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>כמות</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 text-left"
                dir="ltr"
              />
            </div>
            <div>
              <Label>עלות ליחידה (₪)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder={selectedComp?.cost ?? "0"}
                className="mt-1 text-left"
                dir="ltr"
              />
            </div>
          </div>

          {previewTotal !== null && !isNaN(previewTotal) && (
            <p className="text-sm font-medium text-green-700">
              סה״כ: {formatCurrency(String(previewTotal))}
            </p>
          )}
        </div>
        <DialogFooter className="flex-row-reverse gap-2">
          <Button onClick={handleAdd} disabled={addMutation.isPending}>
            {addMutation.isPending ? "מוסיף..." : "הוסף רכיב"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- product details dialog ----------

interface ProductDetailsProps {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
}

function ProductDetailsDialog({ productId, open, onOpenChange, onEdit }: ProductDetailsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addCompOpen, setAddCompOpen] = useState(false);

  const { data: product, isLoading } = useGetProduct(productId, {
    query: { enabled: open && !!productId, queryKey: getGetProductQueryKey(productId) },
  });

  const removeMutation = useRemoveProductComponent();

  function handleRemoveComponent(pcId: string) {
    removeMutation.mutate(
      { id: productId, pcId },
      {
        onSuccess: () => {
          toast({ title: "הרכיב הוסר" });
          queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
        },
        onError: () => {
          toast({ title: "שגיאה בהסרת הרכיב", variant: "destructive" });
        },
      }
    );
  }

  const pw = product as ProductWithComponents | undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground">טוען...</div>
          ) : pw ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl flex-wrap">
                  <span>{pw.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {pw.product_number}
                  </span>
                  <Badge variant={pw.is_active !== false ? "default" : "secondary"}>
                    {pw.is_active !== false ? "פעיל" : "לא פעיל"}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">קטגוריה: </span>
                    <span className="font-medium">{empty(pw.category)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">סוג תוצר: </span>
                    <span className="font-medium">{empty(pw.deliverable_type)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">מחיר מכירה: </span>
                    <span className="font-medium">{formatCurrency(pw.consumer_price)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">עלות מחושבת: </span>
                    <span className="font-medium">{formatCurrency(pw.calculated_cost)}</span>
                  </div>
                  {pw.consumer_price && pw.calculated_cost && (
                    <div>
                      <span className="text-muted-foreground">רווח גולמי: </span>
                      <span className="font-medium text-green-700">
                        {formatCurrency(
                          String(
                            parseFloat(pw.consumer_price) - parseFloat(pw.calculated_cost)
                          )
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {pw.product_explanation && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">תיאור המוצר</p>
                    <p className="text-sm">{pw.product_explanation}</p>
                  </div>
                )}

                {pw.sales_notes && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">הערות פנימיות</p>
                    <p className="text-sm">{pw.sales_notes}</p>
                  </div>
                )}

                <Separator />

                {/* Components */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">
                      רכיבים ({pw.components?.length ?? 0})
                    </h3>
                    <Button size="sm" variant="outline" onClick={() => setAddCompOpen(true)}>
                      <PackagePlus className="w-4 h-4 ml-1" />
                      הוסף רכיב
                    </Button>
                  </div>

                  {!pw.components?.length ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      טרם נוספו רכיבים למוצר זה
                    </p>
                  ) : (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-right py-2 px-3 font-medium">רכיב</th>
                            <th className="text-center py-2 px-3 font-medium">כמות</th>
                            <th className="text-center py-2 px-3 font-medium">עלות ליחידה</th>
                            <th className="text-center py-2 px-3 font-medium">סה״כ</th>
                            <th className="py-2 px-3 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {(pw.components as ProductComponentRow[]).map((pc) => (
                            <tr key={pc.id} className="border-t hover:bg-muted/20">
                              <td className="py-2 px-3">
                                <div className="font-medium">{pc.component_name ?? "—"}</div>
                                {pc.component_deliverable && (
                                  <div className="text-xs text-muted-foreground">
                                    {pc.component_deliverable}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">{pc.default_quantity ?? "1"}</td>
                              <td className="py-2 px-3 text-center">
                                {formatCurrency(pc.default_unit_price)}
                              </td>
                              <td className="py-2 px-3 text-center font-medium">
                                {formatCurrency(pc.total_cost)}
                              </td>
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
                        </tbody>
                        {pw.calculated_cost && parseFloat(pw.calculated_cost) > 0 && (
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
                  )}
                </div>
              </div>

              <DialogFooter className="flex-row-reverse gap-2 mt-4">
                <Button onClick={onEdit} variant="outline">
                  <Pencil className="w-4 h-4 ml-1" />
                  עריכה
                </Button>
              </DialogFooter>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">מוצר לא נמצא</p>
          )}
        </DialogContent>
      </Dialog>

      {addCompOpen && (
        <AddComponentModal
          productId={productId}
          open={addCompOpen}
          onOpenChange={setAddCompOpen}
        />
      )}
    </>
  );
}

// ---------- main page ----------

export default function Products() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [detailsProductId, setDetailsProductId] = useState<string | null>(null);

  const queryParams = {
    ...(filterActive === "active" ? { is_active: true } : {}),
    ...(filterActive === "inactive" ? { is_active: false } : {}),
  };

  const { data: products, isLoading } = useListProducts(queryParams);
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const filtered = (products ?? []).filter(
    (p) =>
      !search ||
      p.name.includes(search) ||
      (p.category ?? "").includes(search)
  );

  function handleCreate(values: ProductFormValues) {
    createMutation.mutate(
      { data: sanitize(values) as unknown as Parameters<typeof createMutation.mutate>[0]["data"] },
      {
        onSuccess: () => {
          toast({ title: "המוצר נוצר בהצלחה" });
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          setCreateOpen(false);
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

  function handleUpdate(values: ProductFormValues) {
    if (!editProduct) return;
    updateMutation.mutate(
      {
        id: editProduct.id,
        data: sanitize(values) as unknown as Parameters<typeof updateMutation.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          toast({ title: "המוצר עודכן בהצלחה" });
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          setEditProduct(null);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "שגיאה בעדכון המוצר";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  }

  return (
    <Shell title="מוצרים">
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
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
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 ml-1" />
          מוצר חדש
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center text-muted-foreground py-16">טוען מוצרים...</div>
      ) : !filtered.length ? (
        <EmptyState
          title={search ? "לא נמצאו מוצרים תואמים" : "אין מוצרים להצגה"}
          description={search ? "נסה חיפוש אחר" : "לחץ על 'מוצר חדש' להוספת מוצר ראשון"}
        />
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-right py-3 px-4 font-semibold">מספר</th>
                <th className="text-right py-3 px-4 font-semibold">שם המוצר</th>
                <th className="text-right py-3 px-4 font-semibold">קטגוריה</th>
                <th className="text-right py-3 px-4 font-semibold">מחיר מכירה</th>
                <th className="text-right py-3 px-4 font-semibold">סטטוס</th>
                <th className="py-3 px-4 w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                    {p.product_number}
                  </td>
                  <td className="py-3 px-4 font-medium">{p.name}</td>
                  <td className="py-3 px-4 text-muted-foreground">{empty(p.category)}</td>
                  <td className="py-3 px-4">{formatCurrency(p.consumer_price)}</td>
                  <td className="py-3 px-4">
                    <Badge variant={p.is_active !== false ? "default" : "secondary"}>
                      {p.is_active !== false ? "פעיל" : "לא פעיל"}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8"
                        onClick={() => setDetailsProductId(p.id)}
                        title="פרטים ורכיבים"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8"
                        onClick={() => setEditProduct(p)}
                        title="עריכה"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            {filtered.length} מוצרים
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>מוצר חדש</DialogTitle>
          </DialogHeader>
          <ProductForm
            defaultValues={toFormValues()}
            onSubmit={handleCreate}
            isPending={createMutation.isPending}
            submitLabel="צור מוצר"
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>עריכת מוצר — {editProduct?.name}</DialogTitle>
          </DialogHeader>
          {editProduct && (
            <ProductForm
              key={editProduct.id}
              defaultValues={toFormValues(editProduct)}
              onSubmit={handleUpdate}
              isPending={updateMutation.isPending}
              submitLabel="שמור שינויים"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      {detailsProductId && (
        <ProductDetailsDialog
          productId={detailsProductId}
          open={!!detailsProductId}
          onOpenChange={(open) => !open && setDetailsProductId(null)}
          onEdit={() => {
            const p = products?.find((x) => x.id === detailsProductId);
            if (p) {
              setDetailsProductId(null);
              setEditProduct(p);
            }
          }}
        />
      )}
    </Shell>
  );
}
