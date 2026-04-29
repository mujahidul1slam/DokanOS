import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PauseCircle, Play, RotateCcw, Clock, Maximize, Minimize,
  Keyboard, Volume2, VolumeX, Settings2
} from "lucide-react";

interface Props {
  stores: { id: string; name: string }[];
  selectedStoreId: string;
  onStoreChange: (id: string) => void;
  salespersonName: string;
  onOpenHeld: () => void;
  onHoldCurrent: () => void;
  onOpenReturn: () => void;
  onOpenRecent: () => void;
  onOpenShift: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  shiftOpen: boolean;
  heldCount: number;
}

const POSToolbar = ({
  stores, selectedStoreId, onStoreChange,
  salespersonName, onOpenHeld, onHoldCurrent, onOpenReturn, onOpenRecent,
  onOpenShift, onToggleFullscreen, isFullscreen,
  soundEnabled, onToggleSound, shiftOpen, heldCount,
}: Props) => {
  return (
    <div className="flex items-center gap-1.5 px-2 md:px-4 py-2 border-b border-border bg-card overflow-x-auto scrollbar-none">
      {/* Store selector */}
      {stores.length > 0 && (
        <Select value={selectedStoreId} onValueChange={onStoreChange}>
          <SelectTrigger className="h-8 w-32 md:w-40 bg-secondary text-xs shrink-0">
            <SelectValue placeholder="Store" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default Store</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Salesperson — hide on mobile */}
      {salespersonName && (
        <Badge variant="outline" className="text-xs gap-1 shrink-0 hidden md:inline-flex">
          👤 {salespersonName}
        </Badge>
      )}

      {/* Shift indicator */}
      <Badge variant={shiftOpen ? "default" : "secondary"} className="text-xs gap-1 cursor-pointer shrink-0" onClick={onOpenShift}>
        <Clock className="h-3 w-3" />
        <span className="hidden sm:inline">{shiftOpen ? "Shift Open" : "No Shift"}</span>
        <span className="sm:hidden">{shiftOpen ? "Open" : "Closed"}</span>
      </Badge>

      <div className="flex-1 min-w-2" />

      {/* Action buttons */}
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={onHoldCurrent} title="Hold order (F5)">
        <PauseCircle className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Hold</span>
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={onOpenHeld} title="Recall held (F6)">
        <Play className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Recall</span>
        {heldCount > 0 && <Badge className="text-[10px] px-1 py-0 ml-0.5">{heldCount}</Badge>}
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={onOpenReturn} title="Return (F7)">
        <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Return</span>
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shrink-0" onClick={onOpenRecent} title="Recent (F8)">
        <Clock className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Recent</span>
      </Button>

      <div className="w-px h-6 bg-border mx-1 hidden md:block" />

      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 hidden md:inline-flex" onClick={onToggleSound} title="Sound">
        {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      </Button>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 hidden md:inline-flex" onClick={onToggleFullscreen} title="Fullscreen (F11)">
        {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
};

export default POSToolbar;
