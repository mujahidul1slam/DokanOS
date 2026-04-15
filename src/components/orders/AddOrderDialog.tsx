import { useState, useEffect, useMemo } from "react";
import { Search, Plus, Minus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  image_url: string | null;
}

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function AddOrderDialog({ open, onOpenChange, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [fulfillment, setFulfillment] = useState<"walkin" | "pickup" | "delivery">("walkin");
  const [shippingCost, setShippingCost] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      supabase.from("products").select("id, name, sku, price, stock_quantity, image_url").eq("is_active", true).order("name").then(({ data }) => {
        setProducts(data || []);
      });
    }
  }, [open]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    if (!q) return products.slice(0, 20);
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)
    ).slice(0, 20);
  }, [products, productSearch]);

  const addItem = (product: Product) => {
    setItems(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, qty: 1 }];
    });
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setItems(prev => prev.filter(i => i.productId !== productId));
    } else {
      setItems(prev => prev.map(i => i.productId === productId ? { ...i, qty } : i));
    }
  };

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  };

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - discount + shippingCost;

  const resetForm = () => {
    setItems([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setFulfillment("walkin");
    setShippingCost(0);
    setDiscount(0);
    setNotes("");
    setProductSearch("");
  };

  const handleCreate = async () => {
    if (items.length === 0) {
      toast.error("Add at least one product");
      return;
    }
    setSaving(true);
    try {
      // Create or find customer
      let customerId: string | null = null;
      if (customerName || customerPhone) {
        if (customerPhone) {
          const { data: existing } = await supabase.from("customers").select("id").eq("phone", customerPhone).limit(1).single();
          if (existing) {
            customerId = existing.id;
            await supabase.from("customers").update({ name: customerName || undefined, address: customerAddress || undefined }).eq("id", customerId);
          }
        }
        if (!customerId) {
          const { data: newC } = await supabase.from("customers").insert({
            name: customerName || "Walk-in",
            phone: customerPhone || null,
            address: customerAddress || null,
            source: "pos",
          }).select("id").single();
          customerId = newC?.id || null;
        }
      }

      // Generate order number
      const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`;

      // Create order
      const { data: order, error } = await supabase.from("orders").insert({
        order_number: orderNumber,
        source: "pos",
        status: "processing",
        payment_status: "unpaid",
        fulfillment_type: fulfillment,
        customer_id: customerId,
        subtotal,
        discount,
        shipping_cost: shippingCost,
        total,
        notes: notes || null,
      }).select("id").single();

      if (error) throw error;

      // Create order items
      const orderItems = items.map(i => ({
        order_id: order.id,
        product_id: i.productId,
        product_name: i.name,
        unit_price: i.price,
        quantity: i.qty,
        line_total: i.price * i.qty,
      }));
      await supabase.from("order_items").insert(orderItems);

      // Timeline
      await supabase.from("order_timeline").insert({
        order_id: order.id,
        event: "created",
        description: "Order created manually",
      });

      toast.success(`Order ${orderNumber} created`);
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Failed to create order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add New Order</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Product Search */}
          <div>
            <Label className="text-xs font-medium">Search Products</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search by name or SKU..."
                className="pl-9"
              />
            </div>
            {productSearch && (
              <ScrollArea className="mt-2 max-h-40 rounded-md border border-border">
                {filteredProducts.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">No products found</div>
                ) : (
                  filteredProducts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { addItem(p); setProductSearch(""); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    >
                      <div>
                        <span className="font-medium">{p.name}</span>
                        {p.sku && <span className="ml-2 text-xs text-muted-foreground">{p.sku}</span>}
                      </div>
                      <span className="text-muted-foreground">৳{p.price.toLocaleString()}</span>
                    </button>
                  ))
                )}
              </ScrollArea>
            )}
          </div>

          {/* Cart Items */}
          {items.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="px-3 py-2 bg-secondary text-xs font-medium text-muted-foreground grid grid-cols-[1fr_80px_100px_80px_32px]">
                <span>Product</span>
                <span className="text-right">Price</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Total</span>
                <span></span>
              </div>
              {items.map(item => (
                <div key={item.productId} className="px-3 py-2 border-t border-border grid grid-cols-[1fr_80px_100px_80px_32px] items-center text-sm">
                  <span className="font-medium truncate">{item.name}</span>
                  <span className="text-right text-muted-foreground">৳{item.price.toLocaleString()}</span>
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(item.productId, item.qty - 1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-6 text-center">{item.qty}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateQty(item.productId, item.qty + 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <span className="text-right font-medium">৳{(item.price * item.qty).toLocaleString()}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeItem(item.productId)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Customer & Fulfillment */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Customer Name</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Address</Label>
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Method</Label>
              <Select value={fulfillment} onValueChange={(v: any) => setFulfillment(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="walkin">Walk-in</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Shipping Cost</Label>
              <Input type="number" value={shippingCost} onChange={(e) => setShippingCost(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discount</Label>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {/* Totals */}
          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>৳{subtotal.toLocaleString()}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive">-৳{discount.toLocaleString()}</span></div>}
            {shippingCost > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>৳{shippingCost.toLocaleString()}</span></div>}
            <Separator />
            <div className="flex justify-between font-semibold text-base"><span>Total</span><span>৳{total.toLocaleString()}</span></div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || items.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
