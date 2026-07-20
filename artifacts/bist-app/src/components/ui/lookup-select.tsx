import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/lib/api-fetch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface LookupOption {
  value: string
  label: string | null
}

interface LookupSelectProps {
  table: string
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
  disabled?: boolean
}

const EMPTY_SENTINEL = "__null__"

export function LookupSelect({
  table,
  value,
  onChange,
  placeholder = "בחר...",
  disabled,
}: LookupSelectProps) {
  const { data: options = [], isLoading } = useQuery<LookupOption[]>({
    queryKey: ["lookup", table],
    queryFn: () => apiFetch<LookupOption[]>(`/api/lookups/${table}`),
    staleTime: 5 * 60 * 1000,
  })

  const selectValue = value ?? EMPTY_SENTINEL

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onChange(v === EMPTY_SENTINEL ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger>
        <SelectValue placeholder={isLoading ? "טוען..." : placeholder} />
      </SelectTrigger>
      <SelectContent dir="rtl">
        <SelectItem value={EMPTY_SENTINEL}>—</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label ?? opt.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
