import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/**
 * Contains-matching for dropdown search.
 *
 * cmdk's built-in scorer is token/prefix oriented: typing a mid-word fragment
 * ("sector 7" in "Uttara Sector 7") often yields "No results". Stripping
 * whitespace and punctuation before a plain substring check makes location
 * names behave the way users type them.
 */
export const matchesSearch = (label: string, value: string, query: string): boolean => {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(label).includes(q) || normalizeSearch(value).includes(q);
};

const normalizeSearch = (v: string) => v.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, "");

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results.",
  disabled,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((o) => o.value === value);

  // Contains-matching, ranked so labels starting with the query stay on top.
  const filtered = React.useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return options;
    const hits = options.filter((o) => matchesSearch(o.label, o.value, query));
    return hits.sort((a, b) => {
      const aStarts = normalizeSearch(a.label).startsWith(q) ? 0 : 1;
      const bStarts = normalizeSearch(b.label).startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    });
  }, [options, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-10 px-3",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.value}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
