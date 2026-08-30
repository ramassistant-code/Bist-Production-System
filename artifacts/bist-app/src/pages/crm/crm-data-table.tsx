import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CrmTableColumn {
  key: string;
  label: ReactNode;
  width: string;
  className?: string;
}

interface CrmDataTableProps {
  columns: CrmTableColumn[];
  children: ReactNode;
  className?: string;
  testId: string;
}

export function CrmDataTable({
  columns,
  children,
  className,
  testId,
}: CrmDataTableProps) {
  return (
    <div
      className={cn(
        "overflow-auto rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <table
        className="min-w-[900px] w-full table-fixed text-right text-sm"
        data-testid={testId}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 border-b border-border bg-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "px-4 py-3 font-medium text-muted-foreground",
                  column.className,
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">{children}</tbody>
      </table>
    </div>
  );
}