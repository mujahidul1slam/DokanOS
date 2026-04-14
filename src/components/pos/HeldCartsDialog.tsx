import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PauseCircle, Play, Trash2, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { Cart } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onRecall: (cart: Cart) => void;
}

interface HeldCartRow {
  id: string;
  label: string;
  cart_data: any;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  created_at: string;
}

const HeldCartsDialog = ({ open, onClose, onRecall }: Props) => {
  const { toast } = useToast();
  const [heldCarts, setHeldCarts] = useState<HeldCartRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("held_carts" as any)
      .select("*")
      .order("created_at", { ascending: false });
    setHeldCarts((data || []) as HeldCartRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleRecall = async (held: HeldCartRow) => {
    const cart = held.cart_data as Cart;
    cart.id = crypto.randomUUID(); // new id
    onRecall(cart);
    // Remove from held
    await supabase.from("held_carts" as any).delete().eq("id", held.id);
    toast({ title: `Recalled: ${held.label}` });
    onClose();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("held_carts" as any).delete().eq("id", id);
    setHeldCarts((prev) => prev.filter((c) => c.id !== id));
    toast({ title: "Held cart deleted" });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <PauseCircle className="h-5 w-5" /> Held Orders
          </DialogTitle>
          <DialogDescription>{heldCarts.length} parked order(s)</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-96">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground animate-pulse">Loading...</div>
          ) : heldCarts.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No held orders</p>
            </div>
          ) : (
            <div className="space-y-2">
              {heldCarts.map((held) => {
                const cart = held.cart_data as Cart;
                const itemCount = cart.items?.length || 0;
                const total = (cart.items || []).reduce((s: number, i: any) => s + i.price * i.qty, 0);
                return (
                  <div key={held.id} className="flex items-center gap-3 rounded-md border border-border p-3 bg-secondary/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{held.label}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-[10px]">{itemCount} items</Badge>
                        <span className="text-xs text-muted-foreground">৳{total.toLocaleString()}</span>
                        {held.customer_name && (
                          <span className="text-xs text-muted-foreground">• {held.customer_name}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(held.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Button size="sm" variant="default" onClick={() => handleRecall(held)}>
                      <Play className="h-3.5 w-3.5 mr-1" /> Recall
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(held.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default HeldCartsDialog;
