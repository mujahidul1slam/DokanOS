import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ShoppingCart, Package, Users, LayoutDashboard, Monitor, Store, Settings, UsersRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ShoppingCart, label: "Orders", path: "/orders" },
  { icon: Package, label: "Products", path: "/products" },
  { icon: Users, label: "Customers", path: "/customers" },
  { icon: Monitor, label: "POS", path: "/pos" },
  { icon: Store, label: "Stores", path: "/stores" },
  { icon: UsersRound, label: "Team", path: "/team" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<{ id: string; order_number: string; customer_name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; sku: string | null }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setOrders([]);
      setCustomers([]);
      setProducts([]);
      return;
    }
    const [ordersRes, customersRes, productsRes] = await Promise.all([
      supabase.from("orders").select("id, order_number, customers(name)").or(`order_number.ilike.%${q}%`).limit(5),
      supabase.from("customers").select("id, name, phone").or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(5),
      supabase.from("products").select("id, name, sku").or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(5),
    ]);
    setOrders((ordersRes.data || []).map((o: any) => ({ id: o.id, order_number: o.order_number, customer_name: o.customers?.name || "" })));
    setCustomers((customersRes.data || []) as any);
    setProducts((productsRes.data || []) as any);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  const go = (path: string) => {
    navigate(path);
    setOpen(false);
    setQuery("");
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput placeholder="Search orders, customers, products, or navigate..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {navItems.map((item) => (
            <CommandItem key={item.path} onSelect={() => go(item.path)}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {orders.length > 0 && (
          <CommandGroup heading="Orders">
            {orders.map((o) => (
              <CommandItem key={o.id} onSelect={() => go("/orders")}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                #{o.order_number} — {o.customer_name || "Unknown"}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {customers.length > 0 && (
          <CommandGroup heading="Customers">
            {customers.map((c) => (
              <CommandItem key={c.id} onSelect={() => go("/customers")}>
                <Users className="mr-2 h-4 w-4" />
                {c.name} {c.phone ? `(${c.phone})` : ""}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {products.length > 0 && (
          <CommandGroup heading="Products">
            {products.map((p) => (
              <CommandItem key={p.id} onSelect={() => go("/products")}>
                <Package className="mr-2 h-4 w-4" />
                {p.name} {p.sku ? `[${p.sku}]` : ""}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};

export default CommandPalette;
