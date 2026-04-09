import { useState } from "react";
import { Plus, Printer, FileText, Trash2, Minus, CreditCard, Banknote, Smartphone, Building2, Truck, Store, Search, UserPlus, ShoppingBag, Ruler, X, Check } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Cart, CartItem, Payment, CustomerData } from "./types";

interface Props {
  carts: Cart[];
  activeCartId: string;
  onSetActiveCart: (id: string) => void;
  onAddCart: () => void;
  onRemoveCart: (id: string) => void;
  onUpdateCart: (id: string, updates: Partial<Cart>) => void;
  onUpdateItem: (cartId: string, uid: string, updates: Partial<CartItem>) => void;
  onRemoveItem: (cartId: string, uid: string) => void;
  onCompleteOrder: (cart: Cart) => void;
  customers: CustomerData[];
  onSearchCustomers: (q: string) => void;
}

const methodIcons: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-4 w-4" />,
  bkash: <Smartphone className="h-4 w-4" />,
  card: <CreditCard className="h-4 w-4" />,
  bank: <Building2 className="h-4 w-4" />,
};

const CartPanel = ({
  carts, activeCartId, onSetActiveCart, onAddCart, onRemoveCart,
  onUpdateCart, onUpdateItem, onRemoveItem, onCompleteOrder,
  customers, onSearchCustomers,
}: Props) => {
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "bkash" | "card" | "bank">("cash");
  const [payAmount, setPayAmount] = useState("");
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [completedCart, setCompletedCart] = useState<Cart | null>(null);

  const cart = carts.find((c) => c.id === activeCartId) || carts[0];
  if (!cart) return null;

  const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const total = subtotal - cart.discount + (cart.fulfillment === "delivery" ? cart.shippingFee : 0);
  const totalPaid = cart.payments.reduce((s, p) => s + p.amount, 0);
  const balance = total - totalPaid;

  const addPayment = () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) return;
    const p: Payment = { id: crypto.randomUUID(), method: payMethod, amount: amt };
    onUpdateCart(cart.id, { payments: [...cart.payments, p] });
    setPayAmount("");
  };

  const removePayment = (pid: string) => {
    onUpdateCart(cart.id, { payments: cart.payments.filter((p) => p.id !== pid) });
  };

  const handleComplete = () => {
    setCompletedCart(cart);
    onCompleteOrder(cart);
    setShowPrintModal(true);
  };

  const selectCustomer = (c: CustomerData) => {
    onUpdateCart(cart.id, { customer: c });
    setCustomerSearch(c.name);
    setShowCustomerDropdown(false);
  };

  return (
    <>
      <div className="flex flex-col h-full border-l border-border bg-card">
        {/* Multi-Cart Tabs */}
        <div className="border-b border-border px-3 pt-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {carts.map((c) => (
              <button
                key={c.id}
                onClick={() => onSetActiveCart(c.id)}
                className={`shrink-0 relative group flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                  c.id === activeCartId
                    ? "bg-background text-foreground border border-b-0 border-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                {c.label}
                {c.items.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.items.length}</Badge>
                )}
                {carts.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveCart(c.id); }}
                    className="ml-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </button>
            ))}
            <button
              onClick={onAddCart}
              className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Customer & Fulfillment */}
        <div className="border-b border-border p-3 space-y-3">
          {/* Customer search */}
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    onSearchCustomers(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder="Search customer..."
                  className="pl-8 h-9 text-sm bg-secondary"
                />
              </div>
              <Button variant="outline" size="sm" className="h-9 gap-1 shrink-0">
                <UserPlus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            {showCustomerDropdown && customerSearch && customers.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
                {customers.map((c) => (
                  <button
                    key={c.id || c.phone}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground ml-2">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {cart.customer && (
            <div className="flex items-center justify-between rounded-md bg-secondary px-3 py-2">
              <div className="text-sm">
                <span className="font-medium">{cart.customer.name}</span>
                <span className="text-muted-foreground ml-2">{cart.customer.phone}</span>
              </div>
              <button onClick={() => { onUpdateCart(cart.id, { customer: null }); setCustomerSearch(""); }} className="text-muted-foreground hover:text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Fulfillment toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => onUpdateCart(cart.id, { fulfillment: "pickup" })}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
                cart.fulfillment === "pickup" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Store className="h-4 w-4" /> Shop Pickup
            </button>
            <button
              onClick={() => onUpdateCart(cart.id, { fulfillment: "delivery" })}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium transition-colors ${
                cart.fulfillment === "delivery" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Truck className="h-4 w-4" /> Home Delivery
            </button>
          </div>

          {/* Delivery fields */}
          {cart.fulfillment === "delivery" && (
            <div className="space-y-2">
              <Input
                value={cart.shippingAddress}
                onChange={(e) => onUpdateCart(cart.id, { shippingAddress: e.target.value })}
                placeholder="Shipping address..."
                className="h-9 text-sm bg-secondary"
              />
              <Input
                value={cart.pathaoZone}
                onChange={(e) => onUpdateCart(cart.id, { pathaoZone: e.target.value })}
                placeholder="Pathao delivery zone..."
                className="h-9 text-sm bg-secondary"
              />
            </div>
          )}
        </div>

        {/* Cart Items */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ShoppingBag className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">Cart is empty</p>
              </div>
            ) : (
              cart.items.map((item) => (
                <div key={item.uid} className="rounded-md border border-border bg-secondary/50 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {item.variationLabel && (
                        <p className="text-xs text-muted-foreground">{item.variationLabel}</p>
                      )}
                      {item.customTailoring && (
                        <Badge variant="outline" className="mt-1 text-[10px] gap-1">
                          <Ruler className="h-3 w-3" /> Custom Tailoring
                        </Badge>
                      )}
                      {item.isCustomItem && (
                        <Badge variant="outline" className="mt-1 text-[10px]">Custom Item</Badge>
                      )}
                    </div>
                    <button onClick={() => onRemoveItem(cart.id, item.uid)} className="text-muted-foreground hover:text-destructive p-1">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center border border-border rounded-md bg-card">
                      <button
                        onClick={() => onUpdateItem(cart.id, item.uid, { qty: Math.max(1, item.qty - 1) })}
                        className="px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="px-2.5 py-1 text-xs font-medium border-x border-border min-w-[1.5rem] text-center">{item.qty}</span>
                      <button
                        onClick={() => onUpdateItem(cart.id, item.uid, { qty: item.qty + 1 })}
                        className="px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-sm font-semibold font-heading">৳{(item.price * item.qty).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Checkout Section */}
        <div className="border-t border-border p-3 space-y-3">
          {/* Financial Summary */}
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>৳{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Discount</span>
              <Input
                type="number"
                value={cart.discount || ""}
                onChange={(e) => onUpdateCart(cart.id, { discount: parseFloat(e.target.value) || 0 })}
                placeholder="0"
                className="h-7 w-24 text-right text-sm bg-secondary"
              />
            </div>
            {cart.fulfillment === "delivery" && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Shipping</span>
                <Input
                  type="number"
                  value={cart.shippingFee || ""}
                  onChange={(e) => onUpdateCart(cart.id, { shippingFee: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="h-7 w-24 text-right text-sm bg-secondary"
                />
              </div>
            )}
            <div className="flex justify-between font-semibold text-base pt-1 border-t border-border">
              <span>Total</span>
              <span className="font-heading">৳{total.toLocaleString()}</span>
            </div>
          </div>

          {/* Split Payments */}
          <div className="space-y-2">
            {cart.payments.length > 0 && (
              <div className="space-y-1">
                {cart.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md bg-secondary px-3 py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      {methodIcons[p.method]}
                      <span className="capitalize">{p.method}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">৳{p.amount.toLocaleString()}</span>
                      <button onClick={() => removePayment(p.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as typeof payMethod)}>
                <SelectTrigger className="h-9 w-28 bg-secondary text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bkash">bKash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Amount"
                className="h-9 flex-1 text-sm bg-secondary"
              />
              <Button variant="secondary" size="sm" onClick={addPayment} className="h-9">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Balance tracker */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">Due</p>
                <p className="font-semibold font-heading text-sm">৳{total.toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">Paid</p>
                <p className="font-semibold font-heading text-sm text-green-400">৳{totalPaid.toLocaleString()}</p>
              </div>
              <div className="rounded-md bg-secondary p-2">
                <p className="text-muted-foreground">{balance > 0 ? "Balance" : "Change"}</p>
                <p className={`font-semibold font-heading text-sm ${balance > 0 ? "text-orange-400" : "text-green-400"}`}>
                  ৳{Math.abs(balance).toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {/* Action button */}
          <Button
            onClick={handleComplete}
            disabled={cart.items.length === 0 || (balance > 0)}
            className="w-full h-14 text-lg font-semibold gap-2"
          >
            <Check className="h-5 w-5" />
            Complete Order — ৳{total.toLocaleString()}
          </Button>
        </div>
      </div>

      {/* Print Modal */}
      <Dialog open={showPrintModal} onOpenChange={setShowPrintModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-center">Order Completed! 🎉</DialogTitle>
            <DialogDescription className="text-center">Print a receipt for the customer?</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => { setShowPrintModal(false); /* TODO: thermal print */ }}
              className="flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary p-6 transition-colors hover:border-primary/50"
            >
              <Printer className="h-10 w-10 text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">Thermal Receipt</p>
                <p className="text-xs text-muted-foreground">80mm</p>
              </div>
            </button>
            <button
              onClick={() => { setShowPrintModal(false); /* TODO: A4 print */ }}
              className="flex flex-col items-center gap-3 rounded-lg border border-border bg-secondary p-6 transition-colors hover:border-primary/50"
            >
              <FileText className="h-10 w-10 text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">A4 Invoice</p>
                <p className="text-xs text-muted-foreground">Full page</p>
              </div>
            </button>
          </div>
          <Button variant="ghost" onClick={() => setShowPrintModal(false)} className="w-full mt-1">
            Skip
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CartPanel;
