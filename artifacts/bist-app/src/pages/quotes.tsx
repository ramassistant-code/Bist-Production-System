import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Quotes() {
  return (
    <Shell title="הצעות מחיר">
      <EmptyState 
        title="אין הצעות מחיר להצגה" 
        description="טרם הופקו הצעות מחיר במערכת." 
      />
    </Shell>
  );
}
