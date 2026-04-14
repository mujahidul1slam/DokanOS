import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Clock, Printer, FileText, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printInvoice } from "./InvoicePrint";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import type { Cart, CartItem, Payment } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface RecentOrder {
  id: string;
  order_number: string;
  total: number;
  subtotal: number;
  discount: number;
  shipping_cost: number;
  status: string;
  payment_status: string;
  source: string;
  notes: string | null;
  created_at: string;
  customer_id: string | null;
}

const RecentOrdersDialog = ({ open, onClose }: Props) => {
  const { settings: invoiceSettings } = useInvoiceSettings();
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("id, order_number, total, subtotal, discount, shipping_cost, status, payment_status, source, notes, created_at, customer_id")
      .eq("source", "pos")
      .order("created_at", { ascending: false })
      .limit(50);
    setOrders((data || []) as RecentOrder[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const filtered = orders.filter((o) =>
    o.order_number.toLowerCase().includes(search.toLowerCase())
  );

  const handleReprint = async (order: RecentOrder) => {
    const format = invoiceSettings?.default_print_format || "thermal";
    // Fetch order items and payments
    const [itemsRes, paymentsRes, customerRes] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", order.id),
      supabase.from("order_payments").select("*").eq("order_id", order.id),
      order.customer_id
        ? supabase.from("customers").select("name, phone, address, city, zone").eq("id", order.customer_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const items: CartItem[] = (itemsRes.data || []).map((i: any) => ({
      uid: i.id,
      productId: i.product_id || "",
      name: i.product_name,
      price: Number(i.unit_price),
      qty: i.quantity,
      customTailoring: false,
    }));

    const payments: Payment[] = (paymentsRes.data || []).map((p: any) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
    }));

    const cart: Cart = {
      id: order.id,
      label: order.order_number,
      items,
      customer: customerRes.data ? {
        name: customerRes.data.name,
        phone: customerRes.data.phone || "",
        address: customerRes.data.address || "",
        city: customerRes.data.city || "",
        zone: customerRes.data.zone || "",
      } : null,
      fulfillment: order.shipping_cost && Number(order.shipping_cost) > 0 ? "delivery" : "walkin",
      shippingAddress: "",
      pathaoZone: "",
      discount: Number(order.discount) || 0,
      discountType: "flat",
      shippingFee: Number(order.shipping_cost) || 0,
      payments,
      notes: order.notes || "",
      taxRate: 0,
    };

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    printInvoice({ orderNumber: order.order_number, cart, subtotal, total: Number(order.total), invoiceSettings }, format);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Clock className="h-5 w-5" /> Recent POS Orders
          </DialogTitle>
          <DialogDescription>View and reprint past POS receipts</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order number..."
            className="pl-9 bg-secondary"
          />
        </div>

        <ScrollArea className="max-h-96">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground animate-pulse">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">No orders found</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((order) => (
                <div key={order.id} className="flex items-center gap-3 rounded-md border border-border p-3 bg-secondary/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{order.order_number}</span>
                      <Badge variant={order.payment_status === "paid" ? "default" : "secondary"} className="text-[10px]">
                        {order.payment_status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-semibold">৳{Number(order.total).toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(order.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleReprint(order)} title="Print Invoice">
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default RecentOrdersDialog;
