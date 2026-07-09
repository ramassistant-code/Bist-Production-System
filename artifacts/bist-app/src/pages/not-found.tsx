import { FileX } from "lucide-react";
import { Link } from "wouter";
import { Shell } from "@/components/layout/shell";

export default function NotFound() {
  return (
    <Shell title="שגיאה 404">
      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
        <FileX className="h-16 w-16 text-gray-400 mb-4" />
        <h1 className="text-3xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-lg text-gray-600 mb-6">העמוד שחיפשת לא נמצא</p>
        <Link href="/" className="px-6 py-2 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 transition-colors">
          חזרה לדשבורד
        </Link>
      </div>
    </Shell>
  );
}
