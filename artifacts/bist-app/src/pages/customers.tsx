import { Shell } from "@/components/layout/shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Customers() {
  return (
    <Shell title="לקוחות">
      <EmptyState 
        title="אין לקוחות להצגה" 
        description="טרם הוספו לקוחות למערכת." 
      />
    </Shell>
  );
}
