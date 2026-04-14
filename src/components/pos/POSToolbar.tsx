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
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card flex-wrap">
      {/* Store selector */}
      {stores.length > 0 && (
        <Select value={selectedStoreId} onValueChange={onStoreChange}>
          <SelectTrigger className="h-8 w-40 bg-secondary text-xs">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default Store</SelectItem>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Salesperson */}
      {salespersonName && (
        <Badge variant="outline" className="text-xs gap-1">
          👤 {salespersonName}
        </Badge>
      )}

      {/* Shift indicator */}
      <Badge variant={shiftOpen ? "default" : "secondary"} className="text-xs gap-1 cursor-pointer" onClick={onOpenShift}>
        <Clock className="h-3 w-3" />
        {shiftOpen ? "Shift Open" : "No Shift"}
      </Badge>

      <div className="flex-1" />

      {/* Action buttons */}
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onHoldCurrent} title="Hold order (F5)">
        <PauseCircle className="h-3.5 w-3.5" /> Hold
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenHeld} title="Recall held (F6)">
        <Play className="h-3.5 w-3.5" /> Recall
        {heldCount > 0 && <Badge className="text-[10px] px-1 py-0 ml-0.5">{heldCount}</Badge>}
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenReturn} title="Return (F7)">
        <RotateCcw className="h-3.5 w-3.5" /> Return
      </Button>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={onOpenRecent} title="Recent (F8)">
        <Clock className="h-3.5 w-3.5" /> Recent
      </Button>

      <div className="w-px h-6 bg-border mx-1" />

      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onToggleSound} title="Sound">
        {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      </Button>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onToggleFullscreen} title="Fullscreen (F11)">
        {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
};

export default POSToolbar;
