import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { format, startOfDay, subDays, startOfYear } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type DatePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "year" | "all" | "custom";

export const presetLabel: Record<DatePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  year: "This Year",
  all: "All Time",
  custom: "Custom Range",
};

export interface ResolvedRange {
  from: Date | null;
  to: Date | null;
  /** Length of period in days, used to compute previous-period comparison. 0 = no comparison. */
  days: number;
}

export const resolveRange = (preset: DatePreset, custom?: DateRange): ResolvedRange => {
  const now = new Date();
  switch (preset) {
    case "today": return { from: startOfDay(now), to: now, days: 1 };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999), days: 1 };
    }
    case "7d": return { from: subDays(now, 7), to: now, days: 7 };
    case "30d": return { from: subDays(now, 30), to: now, days: 30 };
    case "90d": return { from: subDays(now, 90), to: now, days: 90 };
    case "year": {
      const from = startOfYear(now);
      return { from, to: now, days: Math.max(1, Math.round((+now - +from) / 86400000)) };
    }
    case "all": return { from: null, to: null, days: 0 };
    case "custom": {
      if (!custom?.from) return { from: null, to: null, days: 0 };
      const from = startOfDay(custom.from);
      const to = custom.to ? new Date(custom.to.getFullYear(), custom.to.getMonth(), custom.to.getDate(), 23, 59, 59, 999) : now;
      const days = Math.max(1, Math.round((+to - +from) / 86400000));
      return { from, to, days };
    }
  }
};

interface Props {
  preset: DatePreset;
  customRange: DateRange | undefined;
  onPresetChange: (p: DatePreset) => void;
  onCustomRangeChange: (r: DateRange | undefined) => void;
  className?: string;
}

const DatePresetPicker = ({ preset, customRange, onPresetChange, onCustomRangeChange, className }: Props) => {
  const [open, setOpen] = useState(false);

  const customLabel =
    customRange?.from
      ? customRange.to
        ? `${format(customRange.from, "MMM d")} – ${format(customRange.to, "MMM d, yyyy")}`
        : format(customRange.from, "MMM d, yyyy")
      : "Pick dates";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select
        value={preset}
        onValueChange={(v) => {
          const p = v as DatePreset;
          onPresetChange(p);
          if (p === "custom") setOpen(true);
        }}
      >
        <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.entries(presetLabel).map(([k, v]) => (
            <SelectItem key={k} value={k}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 font-normal">
              <CalendarIcon className="h-4 w-4" />
              {customLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={onCustomRangeChange}
              numberOfMonths={2}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

export default DatePresetPicker;
