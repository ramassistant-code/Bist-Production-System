import { useState, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft, Plus, Trash2, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { customFetch, useListProducts, useGetProduct } from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface BasketComponent {
  component_id: string;
  component_name_snapshot: string;
  component_description_snapshot: string;
  quantity: number;
  unit_cost_snapshot: number;
  customer_note: string;
  internal_note: string;
}

interface BasketItem {
  line_id: string;
  source_type: "product" | "manual";
  product_id: string | null;
  product_name_snapshot: string;
  product_description_snapshot: string;
  category_snapshot: string;
  deliverable_type_snapshot: string;
  quantity: number;
  unit_price: number;
  original_unit_price: number;
  manual_price_override: boolean;
  price_override_reason: string;
  customer_note: string;
  internal_note: string;
  components: BasketComponent[];
  components_expanded: boolean;
}

interface PhoneLookupResult {
  found: "customer" | "lead" | "none";
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  tax_id?: string;
}

interface WizardState {
  // Step 1
  phone: string;
  partyType: "customer" | "lead" | "new" | null;
  partyId: string | null;
  partyName: string;
  partyEmail: string;
  newLeadName: string;
  newLeadPhone: string;
  newLeadEmail: string;
  // Step 2
  projectTitle: string;
  validUntil: string;
  // Step 3
  items: BasketItem[];
  discountAmount: string;
  basketManuallyOverridden: boolean;
  basketManualTotal: string;
  basketOverrideNote: string;
  // Step 4
  paymentTerms: string;
  depositAmount: string;
  deliveryTerms: string;
  customerNotes: string;
  operationNotes: string;
  internalNotes: string;
  // Step 5
  generatePdf: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function endOfCurrentMonth(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.toISOString().split("T")[0];
}

const VAT_RATE = 0.18;

function calcBasket(items: BasketItem[], discountAmount: string, basketManuallyOverridden: boolean, basketManualTotal: string) {
  const productsTotal = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const effectiveSubtotal = basketManuallyOverridden && basketManualTotal ? parseFloat(basketManualTotal) : productsTotal;
  const discount = parseFloat(discountAmount) || 0;
  const afterDiscount = Math.max(0, effectiveSubtotal - discount);
  const vat = afterDiscount * VAT_RATE;
  const total = afterDiscount + vat;
  return { productsTotal, effectiveSubtotal, discount, afterDiscount, vat, total };
}

function formatILS(n: number) {
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function newBasketItem(product: Product, components: Array<{ component_id: string; component_name_snapshot: string; component_description_snapshot: string; quantity: number; unit_cost_snapshot: number }>): BasketItem {
  return {
    line_id: crypto.randomUUID(),
    source_type: "product",
    product_id: product.id,
    product_name_snapshot: product.name,
    product_description_snapshot: product.product_explanation ?? "",
    category_snapshot: product.category ?? "",
    deliverable_type_snapshot: product.deliverable_type ?? "",
    quantity: 1,
    unit_price: parseFloat(product.consumer_price ?? "0") || 0,
    original_unit_price: parseFloat(product.consumer_price ?? "0") || 0,
    manual_price_override: false,
    price_override_reason: "",
    customer_note: "",
    internal_note: "",
    components: components.map(c => ({ ...c, customer_note: "", internal_note: "" })),
    components_expanded: false,
  };
}

function newManualItem(): BasketItem {
  return {
    line_id: crypto.randomUUID(),
    source_type: "manual",
    product_id: null,
    product_name_snapshot: "",
    product_description_snapshot: "",
    category_snapshot: "",
    deliverable_type_snapshot: "",
    quantity: 1,
    unit_price: 0,
    original_unit_price: 0,
    manual_price_override: false,
    price_override_reason: "",
    customer_note: "",
    internal_note: "",
    components: [],
    components_expanded: false,
  };
}

const initialState: WizardState = {
  phone: "", partyType: null, partyId: null, partyName: "", partyEmail: "",
  newLeadName: "", newLeadPhone: "", newLeadEmail: "",
  projectTitle: "", validUntil: endOfCurrentMonth(),
  items: [], discountAmount: "", basketManuallyOverridden: false, basketManualTotal: "", basketOverrideNote: "",
  paymentTerms: "", depositAmount: "", deliveryTerms: "",
  customerNotes: "", operationNotes: "", internalNotes: "",
  generatePdf: false,
};

// ── Step indicators ────────────────────────────────────────────────────────

const STEPS = ["זיהוי לקוח/ליד", "סל מוצרים", "תנאים והערות", "סיכום ושמירה"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8" dir="rtl">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2
                ${active ? "bg-primary text-primary-foreground border-primary" : done ? "bg-primary/20 text-primary border-primary/40" : "bg-gray-100 text-gray-400 border-gray-200"}`}>
                {done ? "✓" : i + 1}
              </div>
              <span className={`text-xs hidden sm:block whitespace-nowrap ${active ? "text-primary font-medium" : done ? "text-primary/70" : "text-gray-400"}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${done ? "bg-primary/40" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Party lookup ───────────────────────────────────────────────────

function Step1({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const [lookupDone, setLookupDone] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupResult, setLookupResult] = useState<PhoneLookupResult | null>(null);
  const [isLooking, setIsLooking] = useState(false);

  async function doLookup() {
    if (!state.phone.trim()) { setLookupError("חובה להזין מספר טלפון לפני המשך"); return; }
    setIsLooking(true); setLookupError("");
    try {
      const result = await customFetch<PhoneLookupResult>(`/api/quotes/phone-lookup?phone=${encodeURIComponent(state.phone)}`);
      setLookupResult(result);
      setLookupDone(true);
      if (result.found === "customer" || result.found === "lead") {
        update({ partyType: result.found, partyId: result.id ?? null, partyName: result.name ?? "", partyEmail: result.email ?? "" });
      } else {
        update({ partyType: "new", partyId: null, newLeadPhone: state.phone });
      }
    } catch {
      setLookupError("שגיאה בחיפוש טלפון. אנא נסו שנית.");
    } finally {
      setIsLooking(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold mb-1">שלב 1 — זיהוי לקוח / ליד</h2>
        <p className="text-sm text-muted-foreground">הזינו מספר טלפון לחיפוש לקוח קיים, ליד קיים, או לפתיחת ליד חדש.</p>
      </div>
      <div className="space-y-2">
        <Label>מספר טלפון <span className="text-destructive">*</span></Label>
        <div className="flex gap-2">
          <Input value={state.phone} onChange={(e) => { update({ phone: e.target.value }); setLookupDone(false); setLookupResult(null); }}
            placeholder="050-0000000" dir="ltr" className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && doLookup()} />
          <Button type="button" onClick={doLookup} disabled={isLooking}>
            {isLooking ? "מחפש..." : "חיפוש"}
          </Button>
        </div>
        {lookupError && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{lookupError}</p>}
      </div>

      {lookupDone && lookupResult && state.partyType && (
        <div className="space-y-2">
          <Label>כותרת הצעה / שם פרויקט</Label>
          <Input value={state.projectTitle} onChange={(e) => update({ projectTitle: e.target.value })} placeholder="לדוגמה: חתונת יעל ודוד — הפקה מלאה" />
        </div>
      )}

      {lookupDone && lookupResult && (
        <div className="rounded-lg border p-4 bg-muted/40 space-y-3">
          {lookupResult.found === "customer" && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
              <div>
                <p className="font-medium text-green-700">נמצא לקוח קיים</p>
                <p className="text-sm text-gray-700">{lookupResult.name}</p>
                {lookupResult.email && <p className="text-xs text-gray-500">{lookupResult.email}</p>}
              </div>
            </div>
          )}
          {lookupResult.found === "lead" && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
              <div>
                <p className="font-medium text-blue-700">נמצא ליד קיים</p>
                <p className="text-sm text-gray-700">{lookupResult.name}</p>
                {lookupResult.email && <p className="text-xs text-gray-500">{lookupResult.email}</p>}
              </div>
            </div>
          )}
          {lookupResult.found === "none" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-400 mt-1.5 shrink-0" />
                <p className="font-medium text-orange-700">לא נמצא לקוח או ליד. יפתח ליד חדש.</p>
              </div>
              <div className="space-y-2 pt-1">
                <div className="space-y-1">
                  <Label>שם הליד <span className="text-destructive">*</span></Label>
                  <Input value={state.newLeadName} onChange={(e) => update({ newLeadName: e.target.value })} placeholder="שם מלא" />
                </div>
                <div className="space-y-1">
                  <Label>טלפון</Label>
                  <Input value={state.newLeadPhone} onChange={(e) => update({ newLeadPhone: e.target.value })} dir="ltr" />
                </div>
                <div className="space-y-1">
                  <Label>אימייל</Label>
                  <Input value={state.newLeadEmail} onChange={(e) => update({ newLeadEmail: e.target.value })} type="email" dir="ltr" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Quote basics ───────────────────────────────────────────────────

function Step2({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  return (
    <div className="space-y-6 max-w-lg" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold mb-1">שלב 2 — פרטי הצעה</h2>
        <p className="text-sm text-muted-foreground">מספר ההצעה ייוצר אוטומטית בעת השמירה.</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>כותרת הצעה / שם פרויקט</Label>
          <Input value={state.projectTitle} onChange={(e) => update({ projectTitle: e.target.value })} placeholder="לדוגמה: חתונת יעל ודוד — הפקה מלאה" />
        </div>
        <div className="space-y-1">
          <Label>תוקף הצעה עד תאריך</Label>
          <Input type="date" value={state.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ── Product Selector ───────────────────────────────────────────────────────

interface ProductSelectorProps {
  onAdd: (product: Product) => Promise<void>;
  onClose: () => void;
}

function ProductSelector({ onAdd, onClose }: ProductSelectorProps) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const { data: products } = useListProducts({ search });

  async function handleAdd(p: Product) {
    setAdding(p.id);
    await onAdd(p);
    setAdding(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" dir="rtl">
      <div className="bg-white rounded-xl border border-gray-200 shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold">בחר מוצר מהקטלוג</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        <div className="px-5 py-3 border-b">
          <Input placeholder="חיפוש מוצר..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {(!products || products.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-8">לא נמצאו מוצרים</p>
          )}
          {products?.filter((p) => p.is_active !== false).map((p) => (
            <div key={p.id} className="flex items-start justify-between px-5 py-3 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-gray-900">{p.name}</p>
                {p.category && <p className="text-xs text-muted-foreground">{p.category}</p>}
                {p.consumer_price && (
                  <p className="text-xs text-gray-600 mt-0.5">
                    ₪{parseFloat(p.consumer_price).toLocaleString("he-IL", { maximumFractionDigits: 0 })}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" className="mr-3 shrink-0"
                disabled={adding === p.id} onClick={() => handleAdd(p)}>
                {adding === p.id ? "מוסיף..." : "הוסף"}
              </Button>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t">
          <Button variant="outline" size="sm" className="w-full" onClick={() => { onClose(); }}>סגור</Button>
        </div>
      </div>
    </div>
  );
}

// ── Component Row ──────────────────────────────────────────────────────────

function ComponentRow({
  comp, onChange,
}: {
  comp: BasketComponent;
  onChange: (updated: BasketComponent) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 bg-gray-50 rounded-lg p-3 border border-gray-100">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <p className="text-xs font-medium text-gray-700">{comp.component_name_snapshot}</p>
          {comp.component_description_snapshot && (
            <p className="text-xs text-muted-foreground mt-0.5">{comp.component_description_snapshot}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">כמות:</span>
          <Input type="number" min={0} step={1} value={comp.quantity} className="w-20 h-7 text-xs"
            onChange={(e) => onChange({ ...comp, quantity: parseFloat(e.target.value) || 0 })} />
        </div>
        {comp.unit_cost_snapshot > 0 && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            עלות: ₪{(comp.unit_cost_snapshot * comp.quantity).toLocaleString("he-IL", { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <Label className="text-xs text-gray-500">הערת לקוח (תוצג ללקוח)</Label>
          <Input value={comp.customer_note} className="h-7 text-xs"
            onChange={(e) => onChange({ ...comp, customer_note: e.target.value })} />
        </div>
        <div className="space-y-0.5">
          <Label className="text-xs text-gray-500">הערה פנימית (לא תוצג ללקוח)</Label>
          <Input value={comp.internal_note} className="h-7 text-xs"
            onChange={(e) => onChange({ ...comp, internal_note: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ── Basket Item Row ────────────────────────────────────────────────────────

function BasketRow({
  item, index, onChange, onRemove,
}: {
  item: BasketItem;
  index: number;
  onChange: (updated: BasketItem) => void;
  onRemove: () => void;
}) {
  const lineTotal = item.unit_price * item.quantity;
  const priceChanged = item.unit_price !== item.original_unit_price && item.original_unit_price > 0;

  function setField<K extends keyof BasketItem>(key: K, val: BasketItem[K]) {
    onChange({ ...item, [key]: val });
  }

  function handlePriceChange(val: string) {
    const newPrice = parseFloat(val) || 0;
    const overridden = newPrice !== item.original_unit_price && item.original_unit_price > 0;
    onChange({ ...item, unit_price: newPrice, manual_price_override: overridden });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
        <span className="text-xs text-muted-foreground font-mono pt-0.5 shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          {item.source_type === "manual" ? (
            <Input value={item.product_name_snapshot} placeholder="שם המוצר / שירות *"
              className="font-medium" onChange={(e) => setField("product_name_snapshot", e.target.value)} />
          ) : (
            <p className="font-medium text-gray-900">{item.product_name_snapshot}</p>
          )}
          {item.category_snapshot && <p className="text-xs text-muted-foreground mt-0.5">{item.category_snapshot}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-gray-800">{formatILS(lineTotal)}</span>
          <Button size="sm" variant="ghost" onClick={onRemove} title="הסר">
            <Trash2 className="w-4 h-4 text-red-400" />
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">כמות</Label>
            <Input type="number" min={0.001} step={1} value={item.quantity}
              onChange={(e) => setField("quantity", parseFloat(e.target.value) || 1)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">מחיר יחידה (₪)</Label>
            <Input type="number" min={0} step={0.01} value={item.unit_price}
              onChange={(e) => handlePriceChange(e.target.value)} />
            {priceChanged && !item.manual_price_override && (
              <p className="text-xs text-orange-600">המחיר שונה מהקטלוג</p>
            )}
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label className="text-xs">סה״כ</Label>
            <div className="h-9 flex items-center px-3 bg-gray-50 rounded border text-sm font-medium">{formatILS(lineTotal)}</div>
          </div>
        </div>

        {item.manual_price_override && (
          <div className="space-y-1">
            <Label className="text-xs text-orange-700">סיבת שינוי מחיר <span className="text-destructive">*</span></Label>
            <Input value={item.price_override_reason} placeholder="חובה לפרט את סיבת שינוי המחיר"
              onChange={(e) => setField("price_override_reason", e.target.value)}
              className="border-orange-200 focus-visible:ring-orange-300" />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">תיאור (ניתן לשינוי)</Label>
          <Textarea value={item.product_description_snapshot} rows={2}
            onChange={(e) => setField("product_description_snapshot", e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">הערת לקוח (תוצג ללקוח)</Label>
            <Textarea value={item.customer_note} rows={2}
              onChange={(e) => setField("customer_note", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">הערה פנימית (לא תוצג ללקוח)</Label>
            <Textarea value={item.internal_note} rows={2}
              onChange={(e) => setField("internal_note", e.target.value)} />
          </div>
        </div>

        {/* Components */}
        {item.components.length > 0 && (
          <div>
            <button type="button" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-gray-700 transition-colors"
              onClick={() => setField("components_expanded", !item.components_expanded)}>
              {item.components_expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {item.components.length} רכיבים
            </button>
            {item.components_expanded && (
              <div className="mt-2 space-y-2">
                {item.components.map((comp, ci) => (
                  <ComponentRow key={comp.component_id + ci} comp={comp}
                    onChange={(updated) => {
                      const comps = [...item.components];
                      comps[ci] = updated;
                      setField("components", comps);
                    }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 3: Basket ─────────────────────────────────────────────────────────

function Step3({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const [showSelector, setShowSelector] = useState(false);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);

  async function handleAddProduct(product: Product) {
    setLoadingProductId(product.id);
    try {
      // Fetch product with its components
      type ProdComp = { component_id: string; component_name: string; default_quantity: string; total_cost: string; component_deliverable: string };
      const productWithComponents = await customFetch<{ components?: ProdComp[] }>(`/api/products/${product.id}`);
      const comps = (productWithComponents.components ?? [] as ProdComp[]).map((c: ProdComp) => ({
        component_id: c.component_id,
        component_name_snapshot: c.component_name ?? "",
        component_description_snapshot: c.component_deliverable ?? "",
        quantity: parseFloat(c.default_quantity ?? "1") || 1,
        unit_cost_snapshot: parseFloat(c.total_cost ?? "0") || 0,
      }));
      const item = newBasketItem(product, comps);
      update({ items: [...state.items, item] });
    } finally {
      setLoadingProductId(null);
      setShowSelector(false);
    }
  }

  function updateItem(index: number, updated: BasketItem) {
    const items = [...state.items];
    items[index] = updated;
    update({ items });
  }

  function removeItem(index: number) {
    update({ items: state.items.filter((_, i) => i !== index) });
  }

  const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold mb-1">שלב 3 — סל מוצרים</h2>
        <p className="text-sm text-muted-foreground">הוסיפו מוצרים מהקטלוג, ערכו כמויות ומחירים.</p>
      </div>

      {state.items.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-200 py-10 text-center">
          <p className="text-sm text-muted-foreground mb-3">הסל ריק — יש להוסיף לפחות מוצר אחד</p>
          <Button variant="outline" onClick={() => setShowSelector(true)}>
            <Plus className="w-4 h-4 ml-1" />הוסף מוצר מהקטלוג
          </Button>
        </div>
      )}

      {state.items.map((item, i) => (
        <BasketRow key={item.line_id} item={item} index={i}
          onChange={(updated) => updateItem(i, updated)}
          onRemove={() => removeItem(i)} />
      ))}

      {state.items.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowSelector(true)}>
            <Plus className="w-4 h-4 ml-1" />הוסף מוצר מהקטלוג
          </Button>
          <Button variant="ghost" size="sm" onClick={() => update({ items: [...state.items, newManualItem()] })}>
            <Plus className="w-4 h-4 ml-1" />שורה ידנית
          </Button>
        </div>
      )}

      {/* Totals */}
      {state.items.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h3 className="font-medium text-sm">סיכום סל</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">סה״כ מחושב</span>
              <span className="font-medium">{formatILS(calc.productsTotal)}</span>
            </div>

            {/* Discount */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-600">הנחה כוללת (₪)</span>
              <Input type="number" min={0} step={0.01} value={state.discountAmount}
                placeholder="0"
                onChange={(e) => update({ discountAmount: e.target.value })}
                className="w-32 h-8 text-sm text-left" dir="ltr" />
            </div>

            {/* Manual total override */}
            <div>
              <div className="flex items-center gap-2 mt-1">
                <input type="checkbox" id="basket_override" checked={state.basketManuallyOverridden}
                  onChange={(e) => update({ basketManuallyOverridden: e.target.checked, basketManualTotal: e.target.checked ? state.basketManualTotal : "" })} />
                <label htmlFor="basket_override" className="text-sm text-gray-600 cursor-pointer">שינוי ידני של סה״כ הסל</label>
              </div>
              {state.basketManuallyOverridden && (
                <div className="mt-2 space-y-2">
                  <Input type="number" min={0} step={0.01} value={state.basketManualTotal}
                    placeholder="הזן סה״כ חדש (₪)"
                    onChange={(e) => update({ basketManualTotal: e.target.value })}
                    dir="ltr" />
                  <div className="space-y-1">
                    <Label className="text-xs text-orange-700">הערת שינוי <span className="text-destructive">*</span></Label>
                    <Input value={state.basketOverrideNote} placeholder="חובה לפרט את סיבת שינוי הסה״כ"
                      onChange={(e) => update({ basketOverrideNote: e.target.value })}
                      className="border-orange-200" />
                  </div>
                </div>
              )}
            </div>

            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">סה״כ לפני הנחה</span>
              <span>{formatILS(calc.effectiveSubtotal)}</span>
            </div>
            {calc.discount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>הנחה</span>
                <span>-{formatILS(calc.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">סה״כ אחרי הנחה</span>
              <span>{formatILS(calc.afterDiscount)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>מע״מ 18%</span>
              <span>{formatILS(calc.vat)}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-base">
              <span>סה״כ כולל מע״מ</span>
              <span className="text-primary">{formatILS(calc.total)}</span>
            </div>
          </div>
        </div>
      )}

      {showSelector && <ProductSelector onAdd={handleAddProduct} onClose={() => setShowSelector(false)} />}
      {loadingProductId && (
        <div className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 text-sm text-muted-foreground">טוען רכיבי מוצר...</div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Terms & Notes ──────────────────────────────────────────────────

function Step4({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);
  const deposit = parseFloat(state.depositAmount) || 0;
  const remaining = Math.max(0, calc.total - deposit);

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold mb-1">שלב 3 — תנאים, תשלומים והערות</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label>תוקף הצעה עד תאריך</Label>
          <Input type="date" value={state.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>תנאי תשלום</Label>
          <Input value={state.paymentTerms} onChange={(e) => update({ paymentTerms: e.target.value })} placeholder="לדוגמה: 50% מקדמה, 50% לפני אספקה" />
        </div>
        <div className="space-y-1">
          <Label>זמן אספקה / מועד ביצוע משוער</Label>
          <Input value={state.deliveryTerms} onChange={(e) => update({ deliveryTerms: e.target.value })} placeholder="לדוגמה: 3 שבועות מאישור" />
        </div>
        <div className="space-y-1">
          <Label>מקדמה (₪)</Label>
          <Input type="number" min={0} step={0.01} value={state.depositAmount}
            onChange={(e) => update({ depositAmount: e.target.value })} dir="ltr" />
        </div>
        <div className="space-y-1">
          <Label>יתרה לתשלום (מחושב אוטומטית)</Label>
          <div className="h-9 flex items-center px-3 bg-muted rounded border text-sm font-medium">
            {formatILS(remaining)}
          </div>
        </div>
      </div>

      <Separator />
      <h3 className="font-medium text-sm">הערות</h3>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>הערת לקוח להצעה <span className="text-xs text-muted-foreground">(תוצג ללקוח במסמך ההצעה)</span></Label>
          <Textarea value={state.customerNotes} rows={3}
            onChange={(e) => update({ customerNotes: e.target.value })}
            placeholder="הערה שתופיע בהצעת המחיר ששולחים ללקוח" />
        </div>
        <div className="space-y-1">
          <Label>הערה לצוות האופרציה <span className="text-xs text-muted-foreground">(פנימית — לא מוצגת ללקוח)</span></Label>
          <Textarea value={state.operationNotes} rows={2}
            onChange={(e) => update({ operationNotes: e.target.value })}
            placeholder="הנחיות לצוות הביצוע" />
        </div>
        <div className="space-y-1">
          <Label>הערה פנימית כללית <span className="text-xs text-muted-foreground">(פנימית — לא מוצגת ללקוח)</span></Label>
          <Textarea value={state.internalNotes} rows={2}
            onChange={(e) => update({ internalNotes: e.target.value })}
            placeholder="הערה פנימית כלשהי" />
        </div>
      </div>
    </div>
  );
}

// ── Step 5: Summary ────────────────────────────────────────────────────────

function Step5({ state, update, onSave, onSend, isSaving }: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onSave: () => void;
  onSend: () => void;
  isSaving: boolean;
}) {
  const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);
  const deposit = parseFloat(state.depositAmount) || 0;
  const remaining = Math.max(0, calc.total - deposit);

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold mb-1">שלב 4 — סיכום לפני שמירה</h2>
        <p className="text-sm text-muted-foreground">אנא בדקו את הפרטים לפני שמירת ההצעה.</p>
      </div>

      {/* Party */}
      <div className="rounded-lg border border-gray-200 p-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">לקוח / ליד</p>
        <p className="font-medium">{state.partyName || state.newLeadName}</p>
        {state.partyEmail && <p className="text-sm text-gray-500">{state.partyEmail}</p>}
        <Badge variant="outline" className="text-xs">
          {state.partyType === "customer" ? "לקוח" : state.partyType === "lead" ? "ליד" : "ליד חדש"}
        </Badge>
      </div>

      {/* Quote details */}
      <div className="rounded-lg border border-gray-200 p-4 space-y-2 text-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">פרטי הצעה</p>
        {state.projectTitle && <div className="flex justify-between"><span className="text-gray-500">כותרת</span><span className="font-medium">{state.projectTitle}</span></div>}
        {state.validUntil && <div className="flex justify-between"><span className="text-gray-500">תוקף עד</span><span>{state.validUntil}</span></div>}
        <div className="flex justify-between"><span className="text-gray-500">גרסה</span><span>1</span></div>
      </div>

      {/* Items */}
      <div className="rounded-lg border border-gray-200 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">שורות הצעה ({state.items.length})</p>
        {state.items.map((item) => (
          <div key={item.line_id} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
            <span className="text-gray-700">{item.product_name_snapshot || "שורה ידנית"} × {item.quantity}</span>
            <span className="font-medium">{formatILS(item.unit_price * item.quantity)}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-gray-600">סה״כ לפני הנחה</span><span>{formatILS(calc.effectiveSubtotal)}</span></div>
        {calc.discount > 0 && <div className="flex justify-between text-green-700"><span>הנחה</span><span>-{formatILS(calc.discount)}</span></div>}
        <div className="flex justify-between"><span className="text-gray-600">סה״כ אחרי הנחה</span><span>{formatILS(calc.afterDiscount)}</span></div>
        <div className="flex justify-between text-gray-500"><span>מע״מ 18%</span><span>{formatILS(calc.vat)}</span></div>
        <Separator />
        <div className="flex justify-between font-bold text-base"><span>סה״כ כולל מע״מ</span><span className="text-primary">{formatILS(calc.total)}</span></div>
        {deposit > 0 && <>
          <div className="flex justify-between text-sm"><span className="text-gray-500">מקדמה</span><span>{formatILS(deposit)}</span></div>
          <div className="flex justify-between text-sm font-medium"><span>יתרה לתשלום</span><span>{formatILS(remaining)}</span></div>
        </>}
      </div>

      {/* Terms */}
      {(state.paymentTerms || state.deliveryTerms) && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-1 text-sm">
          {state.paymentTerms && <div><span className="text-gray-500">תנאי תשלום: </span>{state.paymentTerms}</div>}
          {state.deliveryTerms && <div><span className="text-gray-500">זמן אספקה: </span>{state.deliveryTerms}</div>}
        </div>
      )}

      {/* Customer notes */}
      {state.customerNotes && (
        <div className="rounded-lg border border-gray-200 p-4 text-sm">
          <p className="text-xs font-semibold text-muted-foreground mb-1">הערות ללקוח</p>
          <p className="text-gray-700 whitespace-pre-line">{state.customerNotes}</p>
        </div>
      )}

      {/* PDF + Buttons */}
      <div className="space-y-4 pt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={state.generatePdf}
            onChange={(e) => update({ generatePdf: e.target.checked })} />
          <span className="text-sm">לייצר PDF להצעת המחיר</span>
        </label>

        <div className="flex gap-3 flex-wrap">
          <Button onClick={onSave} disabled={isSaving} variant="outline">
            {isSaving ? "שומר..." : "שמור כטיוטה"}
          </Button>
          <Button onClick={onSend} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white">
            {isSaving ? "שולח..." : "שלח הצעה"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Wizard ────────────────────────────────────────────────────────────

interface QuotesNewProps {
  sourceQuoteId?: string;
}

export default function QuotesNew({ sourceQuoteId }: QuotesNewProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);

  function update(partial: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...partial }));
    setErrors([]);
  }

  // Load source quote data if duplicating
  const { data: sourceData, isLoading: sourceLoading } = useQuery({
    queryKey: ["quote-for-dup", sourceQuoteId],
    queryFn: () => customFetch<{
      quote?: Record<string, unknown>;
      currentVersion?: {
        party_snapshot?: Record<string, unknown>;
        items_snapshot?: unknown[];
        totals_snapshot?: Record<string, unknown>;
        terms_snapshot?: Record<string, unknown>;
        notes_snapshot?: Record<string, unknown>;
      };
    }>(`/api/quotes/${sourceQuoteId}`),
    enabled: !!sourceQuoteId,
    staleTime: Infinity,
  });

  // Pre-fill from source if duplicating
  const [prefilled, setPrefilled] = useState(false);
  if (sourceData && !prefilled && !sourceLoading) {
    const ver = sourceData.currentVersion;
    if (ver) {
      const party = ver.party_snapshot as Record<string, string> | undefined;
      const terms = ver.terms_snapshot as Record<string, string> | undefined;
      const notes = ver.notes_snapshot as Record<string, string> | undefined;
      const items = (ver.items_snapshot ?? []) as Array<Record<string, unknown>>;

      setState((prev) => ({
        ...prev,
        partyType: party?.party_type === "customer" ? "customer" : "lead",
        partyId: String(party?.source_id ?? ""),
        partyName: String(party?.business_name ?? party?.contact_name ?? ""),
        partyEmail: String(party?.email ?? ""),
        phone: String(party?.phone ?? ""),
        projectTitle: String(terms?.project_title ?? ""),
        validUntil: String(terms?.valid_until ?? ""),
        paymentTerms: String(terms?.payment_terms ?? ""),
        depositAmount: String(terms?.deposit_amount ?? ""),
        deliveryTerms: String(terms?.delivery_terms ?? ""),
        customerNotes: String(notes?.customer_notes ?? ""),
        operationNotes: String(notes?.operation_notes ?? ""),
        internalNotes: String(notes?.internal_notes ?? ""),
        items: items.map((it) => ({
          line_id: crypto.randomUUID(),
          source_type: (it.source_type as "product" | "manual") ?? "product",
          product_id: it.product_id as string ?? null,
          product_name_snapshot: String(it.product_name_snapshot ?? ""),
          product_description_snapshot: String(it.product_description_snapshot ?? ""),
          category_snapshot: String(it.category_snapshot ?? ""),
          deliverable_type_snapshot: String(it.deliverable_type_snapshot ?? ""),
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
          original_unit_price: Number(it.unit_price) || 0,
          manual_price_override: false,
          price_override_reason: "",
          customer_note: String(it.customer_note ?? ""),
          internal_note: String(it.internal_note ?? ""),
          components: ((it.components_snapshot as Array<Record<string, unknown>>) ?? []).map((c) => ({
            component_id: String(c.component_id ?? ""),
            component_name_snapshot: String(c.component_name_snapshot ?? ""),
            component_description_snapshot: String(c.component_description_snapshot ?? ""),
            quantity: Number(c.quantity) || 1,
            unit_cost_snapshot: Number(c.unit_cost_snapshot) || 0,
            customer_note: String(c.customer_note ?? ""),
            internal_note: String(c.internal_note ?? ""),
          })),
          components_expanded: false,
        })),
      }));
      setPrefilled(true);
    }
  }

  function validateStep(): string[] {
    const errs: string[] = [];
    if (step === 0) {
      if (!state.partyType) errs.push("יש לחפש טלפון ולזהות לקוח/ליד");
      if (state.partyType === "new" && !state.newLeadName.trim()) errs.push("חובה להזין שם ליד חדש");
    }
    if (step === 1) {
      if (state.items.length === 0) errs.push("חובה להוסיף לפחות שורה אחת להצעה");
      for (const item of state.items) {
        if (item.quantity <= 0) errs.push("כמות מוצר חייבת להיות גדולה מ-0");
        if (item.unit_price < 0) errs.push("מחיר לא יכול להיות שלילי");
        if (item.manual_price_override && !item.price_override_reason.trim()) errs.push(`נדרשת סיבת שינוי מחיר עבור: ${item.product_name_snapshot}`);
        if (item.source_type === "manual" && !item.product_name_snapshot.trim()) errs.push("שורה ידנית חייבת לכלול שם");
      }
      if (state.basketManuallyOverridden && !state.basketOverrideNote.trim()) errs.push("חובה להזין הערת שינוי כאשר משנים את סה״כ הסל ידנית");
      const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);
      if (calc.discount > calc.effectiveSubtotal) errs.push("ההנחה הכוללת לא יכולה להיות גבוהה מסה״כ סל המוצרים");
    }
    if (step === 2) {
      if (state.validUntil && new Date(state.validUntil) < new Date()) errs.push("תאריך תוקף ההצעה לא יכול להיות בעבר");
      const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);
      const deposit = parseFloat(state.depositAmount) || 0;
      if (deposit > calc.total) errs.push("המקדמה לא יכולה להיות גבוהה מסה״כ ההצעה");
    }
    return errs;
  }

  function goNext() {
    const errs = validateStep();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setStep((s) => s + 1);
  }

  function buildPayload(sendImmediately: boolean) {
    return {
      party_type: state.partyType as "customer" | "lead" | "new",
      party_id: state.partyId ?? undefined,
      new_party_name: state.partyType === "new" ? state.newLeadName : undefined,
      new_party_phone: state.partyType === "new" ? state.newLeadPhone : undefined,
      new_party_email: state.partyType === "new" ? state.newLeadEmail : undefined,
      project_title: state.projectTitle || undefined,
      valid_until: state.validUntil || undefined,
      items: state.items.map((it) => ({
        line_id: it.line_id,
        source_type: it.source_type,
        product_id: it.product_id,
        product_name_snapshot: it.product_name_snapshot,
        product_description_snapshot: it.product_description_snapshot,
        category_snapshot: it.category_snapshot,
        deliverable_type_snapshot: it.deliverable_type_snapshot,
        quantity: it.quantity,
        unit_price: it.unit_price,
        manual_price_override: it.manual_price_override,
        price_override_reason: it.price_override_reason,
        customer_note: it.customer_note,
        internal_note: it.internal_note,
        components: it.components.map((c) => ({
          component_id: c.component_id,
          component_name_snapshot: c.component_name_snapshot,
          component_description_snapshot: c.component_description_snapshot,
          quantity: c.quantity,
          unit_cost_snapshot: c.unit_cost_snapshot,
          customer_note: c.customer_note,
          internal_note: c.internal_note,
        })),
      })),
      discount_amount: parseFloat(state.discountAmount) || 0,
      basket_manually_overridden: state.basketManuallyOverridden,
      basket_manual_total: state.basketManuallyOverridden ? parseFloat(state.basketManualTotal) : undefined,
      basket_override_note: state.basketOverrideNote || undefined,
      payment_terms: state.paymentTerms || undefined,
      deposit_amount: parseFloat(state.depositAmount) || 0,
      delivery_terms: state.deliveryTerms || undefined,
      customer_notes: state.customerNotes || undefined,
      operation_notes: state.operationNotes || undefined,
      internal_notes: state.internalNotes || undefined,
      generate_pdf: state.generatePdf,
      send_immediately: sendImmediately,
    };
  }

  const saveMutation = useMutation<{ quote: { id: string }; version: { id: string } }, Error & { data?: { error?: string } }, boolean>({
    mutationFn: (sendImmediately: boolean) =>
      customFetch<{ quote: { id: string }; version: { id: string } }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify(buildPayload(sendImmediately)),
      }),
    onSuccess: (data, sendImmediately) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: sendImmediately ? "ההצעה נשלחה וננעלה בהצלחה" : "ההצעה נשמרה כטיוטה" });
      navigate(`/quotes/${data.quote.id}`);
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({ title: err?.data?.error ?? "שגיאה בשמירת ההצעה", variant: "destructive" });
    },
  });

  if (sourceQuoteId && sourceLoading) {
    return (
      <Shell title={sourceQuoteId ? "פתיחת הצעה חדשה על סמך קיימת" : "הצעת מחיר חדשה"}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">טוען נתוני הצעת מקור...</span>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={sourceQuoteId ? "הצעה חדשה (מבוסס על קיימת)" : "הצעת מחיר חדשה"}>
      <div className="h-full overflow-y-auto px-8 py-6">
        <div className="max-w-3xl mx-auto">
          <StepBar current={step} />

          {/* Step content */}
          <div className="min-h-[400px]">
            {step === 0 && <Step1 state={state} update={update} />}
            {step === 1 && <Step3 state={state} update={update} />}
            {step === 2 && <Step4 state={state} update={update} />}
            {step === 3 && (
              <Step5
                state={state}
                update={update}
                onSave={() => saveMutation.mutate(false)}
                onSend={() => saveMutation.mutate(true)}
                isSaving={saveMutation.isPending}
              />
            )}
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li key={i} className="text-sm text-destructive flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{e}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Navigation */}
          {step < 3 && (
            <div className="flex justify-between mt-8 pt-4 border-t">
              <Button variant="outline" onClick={step === 0 ? () => navigate("/quotes") : () => setStep(s => s - 1)}>
                <ChevronRight className="w-4 h-4 ml-1" />
                {step === 0 ? "ביטול" : "הקודם"}
              </Button>
              <Button onClick={goNext}>
                הבא
                <ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="flex justify-start mt-8 pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronRight className="w-4 h-4 ml-1" />חזרה לעריכה
              </Button>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
