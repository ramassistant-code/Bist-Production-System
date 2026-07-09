import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Tasks() {
  return (
    <Shell title="משימות">
      <EmptyState 
        title="אין משימות פתוחות" 
        description="כל המשימות הושלמו או שטרם הוגדרו משימות חדשות." 
      />
    </Shell>
  );
}
