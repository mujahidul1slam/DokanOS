import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: "F1", action: "Focus search bar" },
  { key: "F2", action: "Complete order / Pay" },
  { key: "F3", action: "Add custom item" },
  { key: "F5", action: "Hold current cart" },
  { key: "F6", action: "Recall held carts" },
  { key: "F7", action: "Process return" },
  { key: "F8", action: "Recent orders" },
  { key: "F9", action: "Open/close shift" },
  { key: "F11", action: "Toggle fullscreen" },
  { key: "Esc", action: "Clear search / Close dialog" },
  { key: "?", action: "Show keyboard shortcuts" },
];

const KeyboardShortcutsHelp = ({ open, onClose }: Props) => (
  <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle className="font-heading flex items-center gap-2">
          <Keyboard className="h-5 w-5" /> Keyboard Shortcuts
        </DialogTitle>
        <DialogDescription>Quick actions for the POS</DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        {shortcuts.map((s) => (
          <div key={s.key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
            <span className="text-sm">{s.action}</span>
            <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono font-semibold">{s.key}</kbd>
          </div>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);

export default KeyboardShortcutsHelp;
