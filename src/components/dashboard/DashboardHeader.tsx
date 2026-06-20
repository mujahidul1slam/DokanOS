import { Download, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DatePresetPicker, {
  type DatePreset,
  presetLabel,
} from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";
import type { StoreLite } from "@/hooks/useStoresList";

interface DashboardHeaderProps {
  datePreset: DatePreset;
  customRange: DateRange | undefined;
  onPresetChange: (p: DatePreset) => void;
  onCustomRangeChange: (r: DateRange | undefined) => void;
  onExport: () => void;
  stores: StoreLite[];
  storeId: string;
  onStoreChange: (id: string) => void;
}

const DashboardHeader = ({
  datePreset,
  customRange,
  onPresetChange,
  onCustomRangeChange,
  onExport,
  stores,
  storeId,
  onStoreChange,
}: DashboardHeaderProps) => {
  const activeStore = stores.find((s) => s.id === storeId);
  const scopeLabel =
    storeId === "pos"
      ? " · POS orders"
      : activeStore
        ? ` · ${activeStore.name}`
        : " · All stores";
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {presetLabel[datePreset]}
          {datePreset !== "all" && " · vs prior period"}
          {scopeLabel}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={storeId} onValueChange={onStoreChange}>
          <SelectTrigger className="h-9 w-[180px]">
            <Store className="h-4 w-4 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="All stores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stores</SelectItem>
            <SelectItem value="pos">POS</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DatePresetPicker
          preset={datePreset}
          customRange={customRange}
          onPresetChange={onPresetChange}
          onCustomRangeChange={onCustomRangeChange}
        />
        <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>
    </div>
  );
};

export default DashboardHeader;
