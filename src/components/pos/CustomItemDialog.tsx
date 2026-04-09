import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { CartItem } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}

const CustomItemDialog = ({ open, onClose, onAdd }: Props) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState(1);

  const handleAdd = () => {
    if (!name || !price) return;
    onAdd({
      uid: crypto.randomUUID(),
      productId: "custom-" + Date.now(),
      name,
      price: parseFloat(price),
      qty,
      customTailoring: false,
      isCustomItem: true,
    });
    setName("");
    setPrice("");
    setQty(1);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Add Custom Item</DialogTitle>
          <DialogDescription>Create a bespoke product on the fly</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Item Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Custom suit, alteration..." className="mt-1 bg-secondary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Price (৳)</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className="mt-1 bg-secondary" />
            </div>
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} min={1} className="mt-1 bg-secondary" />
            </div>
          </div>
        </div>
        <Button onClick={handleAdd} disabled={!name || !price} className="w-full h-11 mt-2">
          Add to Cart
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CustomItemDialog;
