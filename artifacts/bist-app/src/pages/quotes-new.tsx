import { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronLeft, Plus, Trash2, ChevronDown, ChevronUp, AlertCircle, Search, X, User, UserCheck } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import type { AppUser } from "@/lib/auth-context";
import { customFetch, useListProducts, useGetProduct } from "@workspace/api-client-react";
import type { Product } from "@workspace/api-client-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface BasketComponent {
  line_id: string;
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
  /** האם לשלוח הצעת מחיר (PDF + חתימה). ברירת מחדל: כן. */
  sendQuote: boolean;
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
  deliveryTerms: string;
  customerNotes: string;
  internalNotes: string;
  salespersonId: string;
  defaultInstallmentsCount: number;
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

function newBasketItem(product: Product, components: Array<Omit<BasketComponent, "line_id">>): BasketItem {
  return {
    line_id: crypto.randomUUID(),
    source_type: "product",
    product_id: product.id,
    product_name_snapshot: product.name,
    product_description_snapshot: product.quote_description_default ?? product.product_explanation ?? "",
    category_snapshot: product.category ?? "",
    deliverable_type_snapshot: product.deliverable_type ?? "",
    quantity: 1,
    unit_price: parseFloat(product.consumer_price ?? "0") || 0,
    original_unit_price: parseFloat(product.consumer_price ?? "0") || 0,
    manual_price_override: false,
    price_override_reason: "",
    customer_note: product.quote_notes_default ?? "",
    internal_note: "",
    components: components.map((component) => ({
      ...component,
      line_id: crypto.randomUUID(),
      customer_note: component.customer_note ?? "",
      internal_note: component.internal_note ?? "",
    })),
    // Open by default: what a product is made of is the point of this step,
    // not a detail to go looking for.
    components_expanded: true,
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
  sendQuote: true,
  projectTitle: "", validUntil: endOfCurrentMonth(),
  items: [], discountAmount: "", basketManuallyOverridden: false, basketManualTotal: "", basketOverrideNote: "",
  deliveryTerms: "",
  customerNotes: "", internalNotes: "",
  salespersonId: "", defaultInstallmentsCount: 1,
};

// ── Step indicators ────────────────────────────────────────────────────────

const STEPS_FULL   = ["זיהוי לקוח/ליד", "סל מוצרים", "תנאים והערות", "סיכום ושמירה"];
const STEPS_DIRECT = ["זיהוי לקוח/ליד", "סל מוצרים", "סיכום ושמירה"];

function StepBar({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-0 mb-8" dir="rtl">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2
                ${active ? "bg-primary text-primary-foreground border-primary" : done ? "bg-primary/20 text-primary border-primary/40" : "bg-muted text-muted-foreground border-border"}`}>
                {done ? "✓" : i + 1}
              </div>
              <span className={`text-sm hidden sm:block whitespace-nowrap ${active ? "text-primary font-medium" : done ? "text-primary/70" : "text-muted-foreground"}`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${done ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Name Search Dialog ─────────────────────────────────────────────────────

interface NameSearchResult {
  type: "customer" | "lead";
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

function NameSearchDialog({ open, onClose, onSelect }: {
  open: boolean;
  onClose: () => void;
  onSelect: (result: NameSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NameSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await customFetch<{ results: NameSearchResult[] }>(
          `/api/quotes/name-search?q=${encodeURIComponent(query.trim())}`
        );
        setResults(data.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>חיפוש לקוח / ליד לפי שם</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="הזינו שם לחיפוש..."
              className="w-full border border-border rounded-lg pr-9 pl-8 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="min-h-[120px] max-h-72 overflow-y-auto space-y-1">
            {loading && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">מחפש...</div>
            )}
            {!loading && query.trim().length >= 2 && results.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">לא נמצאו תוצאות</div>
            )}
            {!loading && query.trim().length < 2 && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">הזינו לפחות 2 תווים לחיפוש</div>
            )}
            {results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => { onSelect(r); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 text-right transition-colors border border-transparent hover:border-border/50"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${r.type === "customer" ? "bg-success/15" : "bg-primary/15"}`}>
                  {r.type === "customer"
                    ? <UserCheck className="w-3.5 h-3.5 text-success-accent" />
                    : <User className="w-3.5 h-3.5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{r.name}</span>
                    <Badge variant="outline" className={`text-xs py-0 ${r.type === "customer" ? "border-success/40 text-success-accent" : "border-primary/40 text-primary"}`}>
                      {r.type === "customer" ? "לקוח" : "ליד"}
                    </Badge>
                  </div>
                  {r.phone && <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">{r.phone}</p>}
                  {!r.phone && <p className="text-xs text-muted-foreground/50 mt-0.5">אין טלפון</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step 1: Party lookup ───────────────────────────────────────────────────

function Step1({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const { appUser } = useAuth();
  const [lookupDone, setLookupDone] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupResult, setLookupResult] = useState<PhoneLookupResult | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [nameSearchOpen, setNameSearchOpen] = useState(false);

  // ── Load users for salesperson dropdown ──────────────────────────────────
  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: () => customFetch<AppUser[]>("/api/users"),
    staleTime: 60_000,
  });

  // Default salesperson to the logged-in user once the list loads
  useEffect(() => {
    if (!state.salespersonId && appUser?.id && users.some(u => u.id === appUser.id)) {
      update({ salespersonId: appUser.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.id, users]);

  async function doLookup(phoneOverride?: string) {
    const phone = phoneOverride ?? state.phone;
    if (!phone.trim()) { setLookupError("חובה להזין מספר טלפון לפני המשך"); return; }
    setIsLooking(true); setLookupError("");
    try {
      const result = await customFetch<PhoneLookupResult>(`/api/quotes/phone-lookup?phone=${encodeURIComponent(phone)}`);
      setLookupResult(result);
      setLookupDone(true);
      if (result.found === "customer" || result.found === "lead") {
        const name = result.name ?? "";
        const now = new Date();
        const dateStr = now.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
        const timeStr = now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
        update({
          partyType: result.found, partyId: result.id ?? null, partyName: name, partyEmail: result.email ?? "",
          projectTitle: `${name} - ${dateStr} ${timeStr}`,
        });
      } else {
        update({ partyType: "new", partyId: null, newLeadPhone: phone });
      }
    } catch {
      setLookupError("שגיאה בחיפוש טלפון. אנא נסו שנית.");
    } finally {
      setIsLooking(false);
    }
  }

  function handleNameSelect(r: NameSearchResult) {
    if (r.phone) {
      update({ phone: r.phone });
      doLookup(r.phone);
    } else {
      const now = new Date();
      const dateStr = now.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
      const timeStr = now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
      update({
        phone: "",
        partyType: r.type,
        partyId: r.id,
        partyName: r.name,
        partyEmail: r.email ?? "",
        newLeadPhone: "",
        projectTitle: `${r.name} - ${dateStr} ${timeStr}`,
      });
      setLookupResult({ found: r.type, id: r.id, name: r.name, email: r.email ?? undefined, phone: undefined });
      setLookupDone(true);
    }
  }

  return (
    <div className="space-y-6 max-w-lg" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold mb-1">שלב 1 — זיהוי לקוח / ליד</h2>
        <p className="text-sm text-muted-foreground">הזינו מספר טלפון לחיפוש לקוח קיים, ליד קיים, או לפתיחת ליד חדש.</p>
      </div>

      {/* ── איש מכירות + תשלומים ─────────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
        <div className="space-y-1">
          <Label>איש מכירות <span className="text-destructive">*</span></Label>
          <select
            value={state.salespersonId}
            onChange={(e) => update({ salespersonId: e.target.value })}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">— בחר איש מכירות —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email}{u.id === appUser?.id ? " (אתה)" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">אליו תשלח הודעת WhatsApp לאחר אישור תשלום</p>
        </div>
        <div className="space-y-1">
          <Label>מספר תשלומים ברירת מחדל (עבור לינק אשראי)</Label>
          <Input
            type="number"
            min={1}
            step={1}
            value={state.defaultInstallmentsCount}
            onChange={(e) => update({ defaultInstallmentsCount: parseInt(e.target.value, 10) || 1 })}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">יטען כברירת מחדל בפתיחת עסקה</p>
        </div>
      </div>

      {/* ── שליחת הצעת מחיר ─────────────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-sm font-medium">שליחת הצעת מחיר ללקוח</p>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="sendQuote"
              checked={state.sendQuote}
              onChange={() => update({ sendQuote: true })}
              className="accent-primary"
            />
            <span>כן — שלח הצעה + PDF</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="sendQuote"
              checked={!state.sendQuote}
              onChange={() => update({ sendQuote: false })}
              className="accent-primary"
            />
            <span>לא — מכירה ישירה בלבד</span>
          </label>
        </div>
        {!state.sendQuote && (
          <p className="text-xs text-muted-foreground">לא יופק PDF. הודעת הווטסאפ תכלול רשימת מוצרים + לינק לתשלום.</p>
        )}
      </div>
      <div className="space-y-2">
        <Label>מספר טלפון <span className="text-destructive">*</span></Label>
        <div className="flex gap-2">
          <Input value={state.phone} onChange={(e) => { update({ phone: e.target.value }); setLookupDone(false); setLookupResult(null); }}
            placeholder="050-0000000" dir="ltr" className="flex-1"
            onKeyDown={(e) => e.key === "Enter" && doLookup()} />
          <Button type="button" onClick={() => doLookup()} disabled={isLooking}>
            {isLooking ? "מחפש..." : "חיפוש"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setNameSearchOpen(true)} title="חיפוש לפי שם">
            <Search className="w-4 h-4 ml-1" />
            חפש לפי שם
          </Button>
        </div>
        {lookupError && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{lookupError}</p>}
      </div>

      <NameSearchDialog
        open={nameSearchOpen}
        onClose={() => setNameSearchOpen(false)}
        onSelect={handleNameSelect}
      />

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
              <div className="w-2 h-2 rounded-full bg-success-accent mt-1.5 shrink-0" />
              <div>
                <p className="font-medium text-success-accent">נמצא לקוח קיים</p>
                <p className="text-sm text-foreground/70">{lookupResult.name}</p>
                {lookupResult.email && <p className="text-xs text-muted-foreground">{lookupResult.email}</p>}
              </div>
            </div>
          )}
          {lookupResult.found === "lead" && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-primary/100 mt-1.5 shrink-0" />
              <div>
                <p className="font-medium text-primary">נמצא ליד קיים</p>
                <p className="text-sm text-foreground/70">{lookupResult.name}</p>
                {lookupResult.email && <p className="text-xs text-muted-foreground">{lookupResult.email}</p>}
              </div>
            </div>
          )}
          {lookupResult.found === "none" && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-warning-accent mt-1.5 shrink-0" />
                <p className="font-medium text-warning-accent">לא נמצא לקוח או ליד. יפתח ליד חדש.</p>
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
        <h2 className="text-2xl font-bold mb-1">שלב 2 — פרטי הצעה</h2>
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
  const [filterCategory, setFilterCategory] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const { data: products } = useListProducts({});

  const activeProducts = (products ?? []).filter((p) => p.is_active !== false);
  const uniqueCategories = Array.from(new Set(activeProducts.map((p) => p.category).filter(Boolean))) as string[];

  const displayed = activeProducts.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.category ?? "").toLowerCase().includes(search.toLowerCase())) &&
      (!filterCategory || p.category === filterCategory)
  );

  async function handleAdd(p: Product) {
    setAdding(p.id);
    await onAdd(p);
    setAdding(null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" dir="rtl">
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h3 className="font-semibold">בחר מוצר מהקטלוג</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {displayed.length === activeProducts.length
                ? `${activeProducts.length} מוצרים`
                : `${displayed.length} מתוך ${activeProducts.length} מוצרים`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="סגור">✕</Button>
        </div>
        <div className="px-5 py-3 border-b flex gap-2">
          <Input className="flex-1" placeholder="חיפוש מוצר..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <select
            className="w-48 shrink-0 h-9 border border-input rounded-md px-2 text-sm bg-background"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            dir="rtl"
          >
            <option value="">כל הקטגוריות</option>
            {uniqueCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/30">
          {displayed.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">לא נמצאו מוצרים</p>
          )}
          {/* Whole row is the target — the old 64px "הוסף" button sat ~400px away
              from the product name it belonged to. */}
          {displayed.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={adding !== null}
              onClick={() => handleAdd(p)}
              className="w-full text-right px-5 py-3 flex items-center gap-4 hover-elevate disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-lg font-medium text-foreground truncate">{p.name}</p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">
                  {[p.product_number, p.category, p.deliverable_type].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-lg font-semibold text-foreground tabular-nums">
                {p.consumer_price
                  ? `₪${parseFloat(p.consumer_price).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`
                  : "—"}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground w-16 text-left">
                {adding === p.id ? "מוסיף..." : "הוסף +"}
              </span>
            </button>
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
  comp, customerNoteOpen, onToggleCustomerNote, onChange, onRemove,
}: {
  comp: BasketComponent;
  customerNoteOpen: boolean;
  onToggleCustomerNote: () => void;
  onChange: (updated: BasketComponent) => void;
  onRemove: () => void;
}) {
  const hasCustomerNote = Boolean(comp.customer_note?.trim());

  return (
    <div className="rounded-md bg-muted/40 border border-border/50">
      {/* Header row: name, quantity, cost, customer-note toggle, remove */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-foreground truncate">{comp.component_name_snapshot}</p>
          {comp.component_description_snapshot && (
            <p className="text-sm text-muted-foreground truncate">{comp.component_description_snapshot}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Label className="text-sm text-muted-foreground">כמות</Label>
          <Input type="number" min={0} step={1} value={comp.quantity} className="w-20 h-9 text-base"
            onChange={(e) => onChange({ ...comp, quantity: parseFloat(e.target.value) || 0 })} />
        </div>
        {comp.unit_cost_snapshot > 0 && (
          <span className="shrink-0 w-32 text-left text-sm text-muted-foreground whitespace-nowrap tabular-nums">
            עלות: ₪{(comp.unit_cost_snapshot * comp.quantity).toLocaleString("he-IL", { maximumFractionDigits: 0 })}
          </span>
        )}
        {/* Toggle only the customer-facing note — internal note is always visible below */}
        <button
          type="button"
          onClick={onToggleCustomerNote}
          className="shrink-0 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {customerNoteOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          הערה ללקוח
          {hasCustomerNote && !customerNoteOpen && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          title="הסר רכיב"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Customer note — toggled */}
      {customerNoteOpen && (
        <div className="px-3 pb-2 pt-1 border-t border-border/50">
          <div className="space-y-1">
            <Label className="text-sm text-muted-foreground">הערה להצעת מחיר (תוצג ללקוח)</Label>
            {/* Textarea, not Input: these hold booking links and multi-line copy. */}
            <Textarea value={comp.customer_note} rows={2}
              onChange={(e) => onChange({ ...comp, customer_note: e.target.value })} />
          </div>
        </div>
      )}

      {/* Internal / ops note — always visible so each component gets its own field */}
      <div className="px-3 pb-2 pt-1 border-t border-border/50">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">הערה פנימית לאופרציה (לא תוצג ללקוח)</Label>
          <Textarea value={comp.internal_note} rows={1}
            placeholder="הערה פנימית לרכיב זה..."
            className="resize-none text-sm"
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [openComponentCustomerNotes, setOpenComponentCustomerNotes] = useState<string[]>([]);
  const hasNotes = Boolean(
    item.product_description_snapshot?.trim() ||
    item.customer_note?.trim() ||
    item.internal_note?.trim()
  );

  function setField<K extends keyof BasketItem>(key: K, val: BasketItem[K]) {
    onChange({ ...item, [key]: val });
  }

  function handlePriceChange(val: string) {
    const newPrice = parseFloat(val) || 0;
    const overridden = newPrice !== item.original_unit_price && item.original_unit_price > 0;
    onChange({ ...item, unit_price: newPrice, manual_price_override: overridden });
  }

  function toggleComponentCustomerNote(componentLineId: string) {
    setOpenComponentCustomerNotes((openIds) =>
      openIds.includes(componentLineId)
        ? openIds.filter((openId) => openId !== componentLineId)
        : [...openIds, componentLineId],
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 bg-muted/50 border-b border-border/50">
        <span className="text-xs text-muted-foreground font-mono pt-0.5 shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          {item.source_type === "manual" ? (
            <Input value={item.product_name_snapshot} placeholder="שם המוצר / שירות *"
              className="font-medium" onChange={(e) => setField("product_name_snapshot", e.target.value)} />
          ) : (
            <p className="text-lg font-medium text-foreground">{item.product_name_snapshot}</p>
          )}
          {item.category_snapshot && <p className="text-sm text-muted-foreground mt-0.5">{item.category_snapshot}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xl font-semibold text-foreground tabular-nums">{formatILS(lineTotal)}</span>
          <Button size="sm" variant="ghost" onClick={onRemove} title="הסר">
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-sm">כמות</Label>
            <Input type="number" min={0.5} step={0.5} value={item.quantity}
              onChange={(e) => setField("quantity", parseFloat(e.target.value) || 1)} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">מחיר יחידה (₪)</Label>
            <Input type="number" min={0} step={0.01} value={item.unit_price}
              onChange={(e) => handlePriceChange(e.target.value)} />
            {priceChanged && !item.manual_price_override && (
              <p className="text-xs text-warning-accent">המחיר שונה מהקטלוג</p>
            )}
          </div>
          <div className="space-y-1 col-span-2 sm:col-span-1">
            <Label className="text-sm">סה״כ</Label>
            <div className="h-9 flex items-center px-3 bg-muted/50 rounded border text-sm font-medium">{formatILS(lineTotal)}</div>
          </div>
        </div>

        {item.manual_price_override && (
          <div className="space-y-1">
            <Label className="text-xs text-warning-accent">סיבת שינוי מחיר (לא יוצג ללקוח) <span className="text-destructive">*</span></Label>
            <Input value={item.price_override_reason} placeholder="חובה לפרט את סיבת שינוי המחיר"
              onChange={(e) => setField("price_override_reason", e.target.value)}
              className="border-warning/40 focus-visible:ring-warning/50" />
          </div>
        )}

        {/* Components sit directly under the price — they are what the customer
            is buying. They used to be last, collapsed, below three empty fields. */}
        {item.components.length > 0 && (
          <div className="space-y-2">
            <button type="button" className="flex items-center gap-1.5 text-base font-medium text-foreground hover:text-muted-foreground transition-colors"
              onClick={() => setField("components_expanded", !item.components_expanded)}>
              {item.components_expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {item.components.length === 1 ? "רכיב אחד" : `${item.components.length} רכיבים`}
            </button>
            {item.components_expanded && (
              <div className="space-y-1.5">
                {item.components.map((comp, ci) => (
                  <ComponentRow
                    key={comp.line_id}
                    comp={comp}
                    customerNoteOpen={openComponentCustomerNotes.includes(comp.line_id)}
                    onToggleCustomerNote={() => toggleComponentCustomerNote(comp.line_id)}
                    onChange={(updated) => {
                      const comps = [...item.components];
                      comps[ci] = updated;
                      setField("components", comps);
                    }}
                    onRemove={() => {
                      setField("components", item.components.filter((_, i) => i !== ci));
                      setOpenComponentCustomerNotes((openIds) => openIds.filter((openId) => openId !== comp.line_id));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Description and notes are usually empty — collapsed so they stop
            pushing the components off the screen. Dot marks filled content. */}
        <div className="border-t border-border/50 pt-3 space-y-2">
          <button type="button" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setNotesOpen((v) => !v)}>
            {notesOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            תיאור והערות
            {hasNotes && !notesOpen && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />
            )}
          </button>
          {notesOpen && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-sm">תיאור (ניתן לשינוי)</Label>
                <Textarea value={item.product_description_snapshot} rows={2}
                  onChange={(e) => setField("product_description_snapshot", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">הערה להצעת מחיר (תוצג ללקוח)</Label>
                <Textarea value={item.customer_note} rows={2}
                  onChange={(e) => setField("customer_note", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-muted-foreground">הערה פנימית (לא תוצג ללקוח)</Label>
                <Textarea value={item.internal_note} rows={2}
                  onChange={(e) => setField("internal_note", e.target.value)} />
              </div>
            </div>
          )}
        </div>
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
      type ProdComp = { component_id: string; component_name: string; default_quantity: string; total_cost: string; component_deliverable: string; component_internal_notes?: string | null; component_quote_description_default?: string | null; component_quote_notes_default?: string | null; sort_order?: number | null };
      const productWithComponents = await customFetch<{ components?: ProdComp[] }>(`/api/products/${product.id}`);
      const comps = (productWithComponents.components ?? [] as ProdComp[])
        .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))
        .map((c: ProdComp) => ({
          component_id: c.component_id,
          component_name_snapshot: c.component_name ?? "",
          component_description_snapshot: c.component_quote_description_default ?? "",
          quantity: parseFloat(c.default_quantity ?? "1") || 1,
          unit_cost_snapshot: parseFloat(c.total_cost ?? "0") || 0,
          customer_note: c.component_quote_notes_default ?? "",
          internal_note: c.component_internal_notes ?? "",
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
        <h2 className="text-2xl font-bold mb-1">שלב 2 — סל מוצרים</h2>
        <p className="text-base text-muted-foreground">הוסיפו מוצרים מהקטלוג, ערכו כמויות ומחירים.</p>
      </div>

      {state.items.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-border py-10 text-center">
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
          <Button size="sm" onClick={() => setShowSelector(true)}>
            <Plus className="w-4 h-4 ml-1" />הוסף מוצר מהקטלוג
          </Button>
        </div>
      )}

      {/* Totals */}
      {state.items.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
          <h3 className="font-medium text-sm">סיכום סל</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">סה״כ מחושב</span>
              <span className="font-medium">{formatILS(calc.productsTotal)}</span>
            </div>

            {/* Discount */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">הנחה כוללת (₪)</span>
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
                <label htmlFor="basket_override" className="text-sm text-muted-foreground cursor-pointer">שינוי ידני של סה״כ הסל</label>
              </div>
              {state.basketManuallyOverridden && (
                <div className="mt-2 space-y-2">
                  <Input type="number" min={0} step={0.01} value={state.basketManualTotal}
                    placeholder="הזן סה״כ חדש (₪)"
                    onChange={(e) => update({ basketManualTotal: e.target.value })}
                    dir="ltr" />
                  <div className="space-y-1">
                    <Label className="text-xs text-warning-accent">סיבת שינוי מחיר (לא יוצג ללקוח) <span className="text-destructive">*</span></Label>
                    <Input value={state.basketOverrideNote} placeholder="חובה לפרט את סיבת שינוי הסה״כ"
                      onChange={(e) => update({ basketOverrideNote: e.target.value })}
                      className="border-warning/40" />
                  </div>
                </div>
              )}
            </div>

            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">סה״כ לפני הנחה</span>
              <span>{formatILS(calc.effectiveSubtotal)}</span>
            </div>
            {calc.discount > 0 && (
              <div className="flex justify-between text-sm text-success-accent">
                <span>הנחה</span>
                <span>-{formatILS(calc.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">סה״כ אחרי הנחה</span>
              <span>{formatILS(calc.afterDiscount)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
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
          <div className="bg-card rounded-lg p-6 text-sm text-muted-foreground">טוען רכיבי מוצר...</div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Terms & Notes ──────────────────────────────────────────────────

function Step4({ state, update }: { state: WizardState; update: (p: Partial<WizardState>) => void }) {
  const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold mb-1">שלב 3 — תנאים והערות</h2>
      </div>
      <div className="space-y-1 max-w-xs">
        <Label>תוקף הצעה עד תאריך</Label>
        <Input type="date" value={state.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
      </div>

      {/* Payment section */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">סה״כ לתשלום כולל מע״מ</span>
          <span className="font-bold text-base text-primary">{formatILS(calc.total)}</span>
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
      </div>
    </div>
  );
}

// ── Step 5: Summary ────────────────────────────────────────────────────────

function Step5({ state, update, onSave, onCreateQuote, isSaving, isCreating, sendQuote = true }: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onSave: () => void;
  onCreateQuote: () => void;
  isSaving: boolean;
  isCreating: boolean;
  sendQuote?: boolean;
}) {
  const calc = calcBasket(state.items, state.discountAmount, state.basketManuallyOverridden, state.basketManualTotal);

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold mb-1">שלב 4 — סיכום לפני שמירה</h2>
        <p className="text-sm text-muted-foreground">אנא בדקו את הפרטים לפני שמירת ההצעה.</p>
      </div>

      {/* Party */}
      <div className="rounded-lg border border-border p-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">לקוח / ליד</p>
        <p className="font-medium">{state.partyName || state.newLeadName}</p>
        {state.partyEmail && <p className="text-sm text-muted-foreground">{state.partyEmail}</p>}
        <Badge variant="outline" className="text-xs">
          {state.partyType === "customer" ? "לקוח" : state.partyType === "lead" ? "ליד" : "ליד חדש"}
        </Badge>
      </div>

      {/* Quote details */}
      <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">פרטי הצעה</p>
        {state.projectTitle && <div className="flex justify-between"><span className="text-muted-foreground">כותרת</span><span className="font-medium">{state.projectTitle}</span></div>}
        {state.validUntil && <div className="flex justify-between"><span className="text-muted-foreground">תוקף עד</span><span>{state.validUntil}</span></div>}
        <div className="flex justify-between"><span className="text-muted-foreground">גרסה</span><span>1</span></div>
      </div>

      {/* Items */}
      <div className="rounded-lg border border-border p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">שורות הצעה ({state.items.length})</p>
        {state.items.map((item) => (
          <div key={item.line_id} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
            <span className="text-foreground/70">{item.product_name_snapshot || "שורה ידנית"} × {item.quantity}</span>
            <span className="font-medium">{formatILS(item.unit_price * item.quantity)}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">סה״כ לפני הנחה</span><span>{formatILS(calc.effectiveSubtotal)}</span></div>
        {calc.discount > 0 && <div className="flex justify-between text-success-accent"><span>הנחה</span><span>-{formatILS(calc.discount)}</span></div>}
        <div className="flex justify-between"><span className="text-muted-foreground">סה״כ אחרי הנחה</span><span>{formatILS(calc.afterDiscount)}</span></div>
        <div className="flex justify-between text-muted-foreground"><span>מע״מ 18%</span><span>{formatILS(calc.vat)}</span></div>
        <Separator />
        <div className="flex justify-between font-bold text-base"><span>סה״כ כולל מע״מ</span><span className="text-primary">{formatILS(calc.total)}</span></div>
      </div>


      {/* Customer notes */}
      {state.customerNotes && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="text-xs font-semibold text-muted-foreground mb-1">הערות ללקוח</p>
          <p className="text-foreground/70 whitespace-pre-line">{state.customerNotes}</p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3 flex-wrap pt-2">
        <Button onClick={onSave} disabled={isSaving || isCreating} variant="outline">
          {isSaving ? "שומר..." : "שמור כטיוטה"}
        </Button>
        <Button onClick={onCreateQuote} disabled={isSaving || isCreating} className="bg-success hover:bg-success/90 text-success-foreground">
          {isCreating ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
              {sendQuote ? "יוצר הצעה ומייצר PDF..." : "שומר..."}
            </span>
          ) : sendQuote ? "יצירת הצעת מחיר" : "שמור עסקה ישירה"}
        </Button>
      </div>
      {isCreating && sendQuote && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
          <div className="bg-card rounded-xl border border-border shadow-2xl p-8 flex flex-col items-center gap-4 max-w-xs">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-foreground text-center">יוצר הצעת מחיר ומפיק PDF...<br/><span className="text-xs text-muted-foreground">אנא המתינו</span></p>
          </div>
        </div>
      )}
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
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);

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
        deliveryTerms: String(terms?.delivery_terms ?? ""),
        customerNotes: String(notes?.customer_notes ?? ""),
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
            line_id: crypto.randomUUID(),
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
      if (!state.salespersonId) errs.push("יש לבחור איש מכירות");
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
      if (state.validUntil) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(state.validUntil) < today) errs.push("תאריך תוקף ההצעה לא יכול להיות בעבר");
      }
    }
    return errs;
  }

  function goNext() {
    const errs = validateStep();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    // דלג על שלב תנאים/הערות כאשר לא שולחים הצעת מחיר
    if (!state.sendQuote && step === 1) {
      setStep(3);
    } else {
      setStep((s) => s + 1);
    }
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
      delivery_terms: state.deliveryTerms || undefined,
      customer_notes: state.customerNotes || undefined,
      internal_notes: state.internalNotes || undefined,
      salesperson_id: state.salespersonId || undefined,
      default_installments_count: state.defaultInstallmentsCount,
      generate_pdf: sendImmediately,
      send_immediately: sendImmediately,
    };
  }

  const saveMutation = useMutation<{ quote: { id: string }; version: { id: string } }, Error & { data?: { error?: string } }, boolean>({
    mutationFn: (sendImmediately: boolean) =>
      customFetch<{ quote: { id: string }; version: { id: string } }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify(buildPayload(sendImmediately)),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: "ההצעה נשמרה כטיוטה" });
      navigate(`/quotes/${data.quote.id}`);
    },
    onError: (err: Error & { data?: { error?: string } }) => {
      toast({ title: err?.data?.error ?? "שגיאה בשמירת ההצעה", variant: "destructive" });
    },
  });

  async function handleCreateQuote() {
    const errs = validateStep();
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);
    setIsCreatingQuote(true);
    try {
      const data = await customFetch<{ quote: { id: string }; version: { id: string } }>("/api/quotes", {
        method: "POST",
        body: JSON.stringify(buildPayload(false)),
      });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      if (state.sendQuote) {
        try {
          await customFetch(`/api/quote-versions/${data.version.id}/generate-pdf`, { method: "POST", body: JSON.stringify({ templateId: null }) });
        } catch {
          toast({ title: "ההצעה נוצרה, אך אירעה שגיאה בהפקת ה-PDF", variant: "destructive" });
        }
      }
      navigate(`/quotes/${data.quote.id}`);
    } catch (err: unknown) {
      const e = err as Error & { data?: { error?: string } };
      toast({ title: e?.data?.error ?? "שגיאה בשמירת ההצעה", variant: "destructive" });
    } finally {
      setIsCreatingQuote(false);
    }
  }

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
        <div className="max-w-5xl mx-auto">
          <StepBar
            current={!state.sendQuote && step === 3 ? 2 : step}
            steps={state.sendQuote ? STEPS_FULL : STEPS_DIRECT}
          />

          {/* Step content */}
          <div className="min-h-[400px]">
            {step === 0 && <Step1 state={state} update={update} />}
            {step === 1 && <Step3 state={state} update={update} />}
            {step === 2 && state.sendQuote && <Step4 state={state} update={update} />}
            {step === 3 && (
              <Step5
                state={state}
                update={update}
                onSave={() => saveMutation.mutate(false)}
                onCreateQuote={handleCreateQuote}
                isSaving={saveMutation.isPending}
                isCreating={isCreatingQuote}
                sendQuote={state.sendQuote}
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
              <Button variant="outline" onClick={() => setStep(state.sendQuote ? 2 : 1)}>
                <ChevronRight className="w-4 h-4 ml-1" />חזרה לעריכה
              </Button>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
