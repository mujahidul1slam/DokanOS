import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import ProductCatalog from "@/components/pos/ProductCatalog";
import VariationModal from "@/components/pos/VariationModal";
import CartPanel from "@/components/pos/CartPanel";
import CustomItemDialog from "@/components/pos/CustomItemDialog";
import type { Product, Cart, CartItem, CustomerData } from "@/components/pos/types";

const createEmptyCart = (label: string): Cart => ({
  id: crypto.randomUUID(),
  label,
  items: [],
  customer: null,
  fulfillment: "walkin",
  shippingAddress: "",
  pathaoZone: "",
  discount: 0,
  shippingFee: 0,
  payments: [],
  notes: "",
});

const POS = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerData[]>([]);

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showCustomItem, setShowCustomItem] = useState(false);

  const [carts, setCarts] = useState<Cart[]>([createEmptyCart("Cart 1")]);
  const [activeCartId, setActiveCartId] = useState(carts[0].id);
  const [cartCounter, setCartCounter] = useState(2);

  useEffect(() => {
    const load = async () => {
      const [prodRes, storeRes] = await Promise.all([
        supabase.from("products").select("id, name, sku, price, stock_quantity, image_url, category, description, store_id, created_at").eq("is_active", true).order("name"),
        supabase.from("stores").select("id, name"),
      ]);
      const prods = (prodRes.data || []) as any[];
      setProducts(prods);
      const cats = [...new Set(prods.map((p) => p.category).filter(Boolean))] as string[];
      setCategories(cats);
      setStores((storeRes.data || []) as { id: string; name: string }[]);
      setLoading(false);
    };
    load();
  }, []);

  const handleSelectProduct = (p: Product) => {
    setSelectedProduct(p);
    setShowVariationModal(true);
  };

  const addToCart = useCallback((item: CartItem) => {
    setCarts((prev) =>
      prev.map((c) =>
        c.id === activeCartId ? { ...c, items: [...c.items, item] } : c
      )
    );
  }, [activeCartId]);

  const updateCart = useCallback((cartId: string, updates: Partial<Cart>) => {
    setCarts((prev) => prev.map((c) => (c.id === cartId ? { ...c, ...updates } : c)));
  }, []);

  const updateItem = useCallback((cartId: string, uid: string, updates: Partial<CartItem>) => {
    setCarts((prev) =>
      prev.map((c) =>
        c.id === cartId
          ? { ...c, items: c.items.map((i) => (i.uid === uid ? { ...i, ...updates } : i)) }
          : c
      )
    );
  }, []);

  const removeItem = useCallback((cartId: string, uid: string) => {
    setCarts((prev) =>
      prev.map((c) => (c.id === cartId ? { ...c, items: c.items.filter((i) => i.uid !== uid) } : c))
    );
  }, []);

  const addCart = useCallback(() => {
    const newCart = createEmptyCart(`Cart ${cartCounter}`);
    setCarts((prev) => [...prev, newCart]);
    setActiveCartId(newCart.id);
    setCartCounter((c) => c + 1);
  }, [cartCounter]);

  const removeCart = useCallback((id: string) => {
    setCarts((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh = createEmptyCart("Cart 1");
        setActiveCartId(fresh.id);
        setCartCounter(2);
        return [fresh];
      }
      if (activeCartId === id) setActiveCartId(next[0].id);
      return next;
    });
  }, [activeCartId]);

  const searchCustomers = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setCustomers([]); return; }
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, email, address, city, zone, area")
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);
    setCustomers((data || []) as CustomerData[]);
  }, []);

  const completeOrder = useCallback(async (cart: Cart): Promise<string> => {
    const subtotal = cart.items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal - cart.discount + (cart.fulfillment === "delivery" ? cart.shippingFee : 0);

    const orderNumber = `POS-${Date.now().toString(36).toUpperCase()}`;

    // Upsert customer — find existing by phone first to avoid duplicates
    let customerId: string | null = cart.customer?.id || null;
    if (cart.customer && !cart.customer.id && cart.customer.name) {
      // Try to find existing customer by phone
      if (cart.customer.phone) {
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", cart.customer.phone)
          .maybeSingle();
        if (existing) {
          customerId = existing.id;
          // Update their info
          await supabase.from("customers").update({
            name: cart.customer.name,
            address: cart.customer.address || null,
          }).eq("id", existing.id);
        }
      }
      // Only insert if no existing match found
      if (!customerId) {
        const { data: newCust } = await supabase
          .from("customers")
          .insert({
            name: cart.customer.name,
            phone: cart.customer.phone || null,
            address: cart.customer.address || null,
            source: 'pos',
          })
          .select("id")
          .single();
        if (newCust) customerId = newCust.id;
      }
    }

    const { data: order } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        source: "pos",
        status: "completed",
        payment_status: "paid",
        subtotal,
        discount: cart.discount,
        shipping_cost: cart.fulfillment === "delivery" ? cart.shippingFee : 0,
        total,
        customer_id: customerId,
        notes: cart.notes || null,
      })
      .select("id")
      .single();

    if (order) {
      const items = cart.items.map((i) => ({
        order_id: order.id,
        product_id: i.isCustomItem ? null : i.productId,
        product_name: i.name + (i.variationLabel ? ` - ${i.variationLabel}` : ""),
        quantity: i.qty,
        unit_price: i.price,
        line_total: i.price * i.qty,
      }));
      await supabase.from("order_items").insert(items);

      if (cart.payments.length > 0) {
        const payments = cart.payments.map((p) => ({
          order_id: order.id,
          method: p.method,
          amount: p.amount,
        }));
        await supabase.from("order_payments").insert(payments);
      }
    }

    // Reset cart
    setCarts((prev) => {
      const next = prev.map((c) => (c.id === cart.id ? createEmptyCart(c.label) : c));
      setActiveCartId(next.find((c) => c.label === cart.label)?.id || next[0].id);
      return next;
    });

    return orderNumber;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-5rem)] text-muted-foreground">
        <div className="animate-pulse text-lg font-heading">Loading POS...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] -m-6">
      <div className="w-[60%] p-4">
        <ProductCatalog
          products={products}
          categories={categories}
          stores={stores}
          onSelectProduct={handleSelectProduct}
          onAddCustomItem={() => setShowCustomItem(true)}
        />
      </div>
      <div className="w-[40%]">
        <CartPanel
          carts={carts}
          activeCartId={activeCartId}
          onSetActiveCart={setActiveCartId}
          onAddCart={addCart}
          onRemoveCart={removeCart}
          onUpdateCart={updateCart}
          onUpdateItem={updateItem}
          onRemoveItem={removeItem}
          onCompleteOrder={completeOrder}
          customers={customers}
          onSearchCustomers={searchCustomers}
        />
      </div>
      <VariationModal
        product={selectedProduct}
        open={showVariationModal}
        onClose={() => setShowVariationModal(false)}
        onAddToCart={addToCart}
      />
      <CustomItemDialog
        open={showCustomItem}
        onClose={() => setShowCustomItem(false)}
        onAdd={addToCart}
      />
    </div>
  );
};

export default POS;
