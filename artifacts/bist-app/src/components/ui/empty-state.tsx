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
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] border-2 border-dashed border-gray-200 rounded-xl bg-white/50">
      <div className="p-4 bg-gray-100 rounded-full mb-4">
        <FileText className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}
