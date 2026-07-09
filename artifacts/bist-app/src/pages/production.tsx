import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Production() {
  return (
    <Shell title="הפקה">
      <EmptyState 
        title="אין תהליכי הפקה להצגה" 
        description="טרם נוספו פרויקטי הפקה למערכת." 
      />
    </Shell>
  );
}
