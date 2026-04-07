import { useEffect, useState } from "react";
import { Search, Plus, Minus, Trash2, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

const POS = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, sku, price, stock_quantity")
        .eq("is_active", true)
        .gt("stock_quantity", 0)
        .order("name");
      setProducts((data || []) as Product[]);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || "").toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === p.id);
      if (existing) return prev.map((c) => (c.id === p.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { id: p.id, name: p.name, price: Number(p.price), qty: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) =>
    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: Math.max(1, c.qty + delta) } : c)));

  const remove = (id: string) => setCart((prev) => prev.filter((c) => c.id !== id));

  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  return (
    <div className="flex gap-6 h-[calc(100vh-5rem)]">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-heading text-2xl font-semibold">Point of Sale</h1>
        </div>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Scan barcode or search..."
            className="h-9 w-full rounded-md border border-border bg-secondary pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 overflow-auto flex-1">
          {filtered.map((p) => (
            <button key={p.id} onClick={() => addToCart(p)} className="flex flex-col items-start rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50">
              <p className="text-sm font-medium text-card-foreground">{p.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{p.sku || "—"}</p>
              <div className="mt-auto pt-3 flex w-full items-center justify-between">
                <span className="font-heading text-base font-semibold text-card-foreground">৳{Number(p.price).toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{p.stock_quantity} in stock</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="w-80 flex flex-col rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-heading text-sm font-medium text-card-foreground">Cart ({cart.length})</h2>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No items in cart</p>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-md border border-border p-2.5">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm text-card-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">৳{item.price.toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => updateQty(item.id, -1)} className="h-6 w-6 rounded bg-secondary flex items-center justify-center text-foreground hover:bg-muted"><Minus className="h-3 w-3" /></button>
                  <span className="w-6 text-center text-sm text-foreground">{item.qty}</span>
                  <button onClick={() => updateQty(item.id, 1)} className="h-6 w-6 rounded bg-secondary flex items-center justify-center text-foreground hover:bg-muted"><Plus className="h-3 w-3" /></button>
                </div>
                <button onClick={() => remove(item.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium text-card-foreground">৳{subtotal.toLocaleString()}</span>
          </div>
          <button disabled={cart.length === 0} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed">
            <CreditCard className="h-4 w-4" /> Charge ৳{subtotal.toLocaleString()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default POS;
