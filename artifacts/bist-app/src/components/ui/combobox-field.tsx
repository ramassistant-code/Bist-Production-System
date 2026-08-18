import * as React from "react"
import { ChevronsUpDown, X, Loader2 } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  id: string
  label: string
}

interface ComboboxFieldProps {
  value: string | null
  onChange: (id: string | null) => void
  fetchOptions: (term: string) => Promise<ComboboxOption[]>
  fetchById?: (id: string) => Promise<ComboboxOption | null>
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ComboboxField({
  value,
  onChange,
  fetchOptions,
  fetchById,
  placeholder = "בחר...",
  disabled = false,
  className,
}: ComboboxFieldProps) {
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")
  const [options, setOptions] = React.useState<ComboboxOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchOptionsRef = React.useRef(fetchOptions)
  fetchOptionsRef.current = fetchOptions

  // Resolve label for existing value on mount / value change
  React.useEffect(() => {
    if (!value) { setSelectedLabel(null); return }
    if (fetchById) {
      fetchById(value)
        .then((opt) => { if (opt) setSelectedLabel(opt.label) })
        .catch(() => {})
    }
  }, [value, fetchById])

  // Core fetch — always uses the latest fetchOptions via ref
  const doFetch = React.useCallback(async (term: string) => {
    setLoading(true)
    try {
      const results = await fetchOptionsRef.current(term)
      setOptions(results)
    } catch (err) {
      console.error("[ComboboxField] fetchOptions error:", err)
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [])

  // On open: fetch immediately
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setInputValue("")
      return
    }
    doFetch("")
  }

  // On search term change: debounce 300ms
  function handleInputChange(term: string) {
    setInputValue(term)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doFetch(term), 300)
  }

  function handleSelect(option: ComboboxOption) {
    onChange(option.id)
    setSelectedLabel(option.label)
    setOpen(false)
    setInputValue("")
  }

  function handleClear(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    onChange(null)
    setSelectedLabel(null)
    setInputValue("")
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-9 px-3",
            !selectedLabel && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-sm">{selectedLabel ?? placeholder}</span>
          <div className="flex items-center gap-1 mr-1 shrink-0">
            {value && !disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => e.key === "Enter" && handleClear(e)}
                className="rounded-sm opacity-50 hover:opacity-100 p-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="נקה בחירה"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        dir="rtl"
        align="start"
        sideOffset={4}
        // prevent wheel events from bubbling up to Dialog's scroll container
        onWheel={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="חיפוש..."
            value={inputValue}
            onValueChange={handleInputChange}
            className="text-right"
          />
          <CommandList
            style={{ maxHeight: "240px", overflowY: "auto" }}
          >
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                טוען...
              </div>
            )}
            {!loading && options.length === 0 && (
              <CommandEmpty>
                {inputValue ? "לא נמצאו תוצאות" : "אין פריטים להצגה"}
              </CommandEmpty>
            )}
            {!loading && options.length > 0 && (
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => handleSelect(option)}
                    className={cn(
                      "cursor-pointer",
                      value === option.id && "bg-accent font-medium",
                    )}
                  >
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
