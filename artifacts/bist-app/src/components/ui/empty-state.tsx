import { FileText } from "lucide-react";

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export function EmptyState({ 
  title = "אין נתונים להצגה", 
  description = "לא נמצאו נתונים עבור עמוד זה עדיין." 
}: EmptyStateProps) {
  return (
    <div className="w-full flex flex-col items-center justify-center h-full min-h-[400px] border-2 border-dashed border-border rounded-xl bg-card/50">
      <div className="p-4 bg-muted rounded-full mb-4">
        <FileText className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
