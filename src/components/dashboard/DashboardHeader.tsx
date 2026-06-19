import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import DatePresetPicker, {
  type DatePreset,
  presetLabel,
} from "@/components/DatePresetPicker";
import type { DateRange } from "react-day-picker";

interface DashboardHeaderProps {
  datePreset: DatePreset;
  customRange: DateRange | undefined;
  onPresetChange: (p: DatePreset) => void;
  onCustomRangeChange: (r: DateRange | undefined) => void;
  onExport: () => void;
}

const DashboardHeader = ({
  datePreset,
  customRange,
  onPresetChange,
  onCustomRangeChange,
  onExport,
}: DashboardHeaderProps) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">
        {presetLabel[datePreset]}
        {datePreset !== "all" && " · vs prior period"}
      </p>
    </div>
    <div className="flex items-center gap-2 flex-wrap">
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

export default DashboardHeader;
