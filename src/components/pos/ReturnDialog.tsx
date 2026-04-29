import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, RotateCcw, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logAction } from "@/lib/auditLog";
import { useGlobalStockEnabled } from "@/lib/stockSettings";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface OrderResult {
  id: string;
  order_number: string;
  total: number;
  created_at: string;
  customer_name?: string;
}

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  product_id: string | null;
}

const ReturnDialog = ({ open, onClose }: Props) => {
  const { toast } = useToast();
  const globalStockEnabled = useGlobalStockEnabled();
  const [searchQuery, setSearchQuery] = useState("");
  const [orders, setOrders] = useState<OrderResult[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [restock, setRestock] = useState(true);
  const [notes, setNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const searchOrders = async () => {
    if (!searchQuery || searchQuery.length < 2) return;
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, created_at, customer_id")
      .or(`order_number.ilike.%${searchQuery}%`)
      .order("created_at", { ascending: false })
      .limit(10);
    
    if (data) {
      const ordersWithCustomers = await Promise.all(
        data.map(async (o: any) => {
          let customer_name;
          if (o.customer_id) {
            const { data: c } = await supabase.from("customers").select("name").eq("id", o.customer_id).single();
            customer_name = c?.name;
          }
          return { ...o, customer_name };
        })
      );
      setOrders(ordersWithCustomers);
    }
  };

  const selectOrder = async (order: OrderResult) => {
    setSelectedOrder(order);
    const { data } = await supabase
      .from("order_items")
      .select("id, product_name, quantity, unit_price, product_id")
      .eq("order_id", order.id);
    setOrderItems((data || []) as OrderItem[]);
    setReturnItems({});
  };

  const toggleReturnItem = (itemId: string, maxQty: number) => {
    setReturnItems((prev) => {
      if (prev[itemId]) {
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: maxQty };
    });
  };

  const updateReturnQty = (itemId: string, qty: number) => {
    setReturnItems((prev) => ({ ...prev, [itemId]: qty }));
  };

  const refundTotal = orderItems
    .filter((i) => returnItems[i.id])
    .reduce((s, i) => s + i.unit_price * (returnItems[i.id] || 0), 0);

  const handleReturn = async () => {
    if (!selectedOrder || Object.keys(returnItems).length === 0) return;
    setProcessing(true);

    try {
      const returnNumber = `RET-${Date.now().toString(36).toUpperCase()}`;
      const items = orderItems
        .filter((i) => returnItems[i.id])
        .map((i) => ({
          order_item_id: i.id,
          product_name: i.product_name,
          product_id: i.product_id,
          quantity: returnItems[i.id],
          unit_price: i.unit_price,
        }));

      await supabase.from("pos_returns" as any).insert({
        order_id: selectedOrder.id,
        return_number: returnNumber,
        items,
        reason,
        refund_amount: refundTotal,
        refund_method: refundMethod,
        restock,
        notes,
      });

      // Restock items if needed
      if (restock) {
        for (const item of items) {
          if (item.product_id) {
            const { data: prod } = await supabase.from("products").select("stock_quantity, manage_stock").eq("id", item.product_id).single();
            if (prod && (globalStockEnabled || prod.manage_stock === true)) {
              await supabase.from("products").update({ stock_quantity: prod.stock_quantity + item.quantity }).eq("id", item.product_id);
            }
          }
        }
      }

      // Add timeline entry
      await supabase.from("order_timeline").insert({
        order_id: selectedOrder.id,
        event: "return_processed",
        description: `Return ${returnNumber}: ৳${refundTotal.toLocaleString()} refunded via ${refundMethod}`,
      });

      await logAction("create", "pos_return", selectedOrder.id, {
        return_number: returnNumber, refund_amount: refundTotal, refund_method: refundMethod, restock,
      });

      toast({ title: "Return processed", description: `${returnNumber} — ৳${refundTotal.toLocaleString()} refunded` });
      
      // Reset
      setSelectedOrder(null);
      setOrderItems([]);
      setReturnItems({});
      setReason("");
      setNotes("");
      onClose();
    } catch (err) {
      toast({ title: "Error processing return", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <RotateCcw className="h-5 w-5" /> Process Return
          </DialogTitle>
          <DialogDescription>Search for an order to process a return or exchange</DialogDescription>
        </DialogHeader>

        {!selectedOrder ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchOrders()}
                placeholder="Search by order number..."
                className="bg-secondary"
              />
              <Button onClick={searchOrders} size="sm"><Search className="h-4 w-4" /></Button>
            </div>
            <ScrollArea className="max-h-60">
              {orders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => selectOrder(o)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted flex justify-between items-center"
                >
                  <div>
                    <span className="font-mono text-sm font-medium">{o.order_number}</span>
                    {o.customer_name && <span className="text-muted-foreground text-sm ml-2">{o.customer_name}</span>}
                  </div>
                  <span className="text-sm font-semibold">৳{Number(o.total).toLocaleString()}</span>
                </button>
              ))}
            </ScrollArea>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-sm">{selectedOrder.order_number}</span>
                <span className="text-muted-foreground text-sm ml-2">৳{Number(selectedOrder.total).toLocaleString()}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>Change</Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Select items to return:</Label>
              {orderItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-md border border-border p-3 bg-secondary/50">
                  <input
                    type="checkbox"
                    checked={!!returnItems[item.id]}
                    onChange={() => toggleReturnItem(item.id, item.quantity)}
                    className="rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.product_name}</p>
                    <p className="text-xs text-muted-foreground">৳{Number(item.unit_price).toLocaleString()} × {item.quantity}</p>
                  </div>
                  {returnItems[item.id] && (
                    <Input
                      type="number"
                      min={1}
                      max={item.quantity}
                      value={returnItems[item.id]}
                      onChange={(e) => updateReturnQty(item.id, Math.min(item.quantity, parseInt(e.target.value) || 1))}
                      className="h-8 w-16 text-sm text-center bg-background"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="mt-1 bg-secondary"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="defective">Defective</SelectItem>
                    <SelectItem value="wrong_item">Wrong Item</SelectItem>
                    <SelectItem value="size_issue">Size Issue</SelectItem>
                    <SelectItem value="customer_changed_mind">Changed Mind</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Refund Method</Label>
                <Select value={refundMethod} onValueChange={setRefundMethod}>
                  <SelectTrigger className="mt-1 bg-secondary"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bkash">bKash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="store_credit">Store Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Restock Items</p>
                <p className="text-xs text-muted-foreground">Add returned items back to inventory</p>
              </div>
              <Switch checked={restock} onCheckedChange={setRestock} />
            </div>

            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Return notes..."
              className="bg-secondary min-h-[50px]"
            />

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="text-sm text-muted-foreground">Refund Total</span>
              <span className="text-lg font-heading font-semibold">৳{refundTotal.toLocaleString()}</span>
            </div>

            <Button
              onClick={handleReturn}
              disabled={Object.keys(returnItems).length === 0 || processing}
              className="w-full h-12"
            >
              {processing ? "Processing..." : `Process Return — ৳${refundTotal.toLocaleString()}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReturnDialog;
