import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Products() {
  return (
    <Shell title="מוצרים">
      <EmptyState 
        title="אין מוצרים להצגה" 
        description="טרם הוספו מוצרים למערכת." 
      />
    </Shell>
  );
}
