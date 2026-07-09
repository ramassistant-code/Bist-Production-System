import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Dashboard() {
  return (
    <Shell title="דשבורד">
      <EmptyState 
        title="אין נתונים להצגה בדשבורד" 
        description="פעילות המערכת תוצג כאן בקרוב." 
      />
    </Shell>
  );
}
