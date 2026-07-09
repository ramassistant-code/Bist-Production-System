import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Settings() {
  return (
    <Shell title="הגדרות">
      <EmptyState 
        title="הגדרות מערכת" 
        description="עמוד ההגדרות בבנייה." 
      />
    </Shell>
  );
}
