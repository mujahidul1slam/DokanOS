import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import ProductCatalog from "@/components/pos/ProductCatalog";
import VariationModal from "@/components/pos/VariationModal";
import CartPanel from "@/components/pos/CartPanel";
import CustomItemDialog from "@/components/pos/CustomItemDialog";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showCustomItem, setShowCustomItem] = useState(false);

  const [carts, setCarts] = useState<Cart[]>([createEmptyCart("Cart 1")]);
  const [activeCartId, setActiveCartId] = useState(carts[0].id);
  const [cartCounter, setCartCounter] = useState(2);

  // Barcode scanner support
  useBarcodeScanner(useCallback(async (barcode: string) => {
    // Search by barcode or SKU
    const product = products.find(
      (p) => (p as any).barcode === barcode || p.sku === barcode
    );
    if (product) {
      // Check for variations
      const { data: variations } = await supabase
        .from("product_variations")
        .select("id, barcode, sku")
        .eq("product_id", product.id);

      const matchingVariation = (variations || []).find(
        (v: any) => v.barcode === barcode || v.sku === barcode
      );

      if (matchingVariation || (variations && variations.length > 0)) {
        setSelectedProduct(product);
        setShowVariationModal(true);
      } else {
        // Add directly to cart
        addToCart({
          uid: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          qty: 1,
          variationId: null,
          variationLabel: null,
          isCustomItem: false,
        });
        toast({ title: `Added: ${product.name}` });
      }
    } else {
      // Check product_variations barcode
      const { data: varMatch } = await supabase
        .from("product_variations")
        .select("id, name, price, product_id, barcode")
        .eq("barcode", barcode)
        .limit(1);

      if (varMatch && varMatch.length > 0) {
        const v = varMatch[0];
        const parentProduct = products.find((p) => p.id === v.product_id);
        addToCart({
          uid: crypto.randomUUID(),
          productId: v.product_id,
          name: parentProduct?.name || "Product",
          price: Number(v.price),
          qty: 1,
          variationId: v.id,
          variationLabel: v.name,
          isCustomItem: false,
        });
        toast({ title: `Added: ${parentProduct?.name} - ${v.name}` });
      } else {
        toast({ title: "Product not found", description: `No match for barcode: ${barcode}`, variant: "destructive" });
      }
    }
  }, [products]));

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

      // Reduce local stock and push to WooCommerce
      for (const item of cart.items) {
        if (item.isCustomItem || !item.productId) continue;
        if (item.variationId) {
          const { data: v } = await supabase.from("product_variations").select("stock_quantity").eq("id", item.variationId).single();
          if (v) {
            await supabase.from("product_variations").update({ stock_quantity: Math.max(0, v.stock_quantity - item.qty) }).eq("id", item.variationId);
          }
        }
        // Update parent product stock
        const { data: prod } = await supabase.from("products").select("stock_quantity, woo_product_id, store_id").eq("id", item.productId).single();
        if (prod) {
          await supabase.from("products").update({ stock_quantity: Math.max(0, prod.stock_quantity - item.qty) }).eq("id", item.productId);
          // Push stock to WooCommerce if linked
          if (prod.woo_product_id) {
            supabase.functions.invoke("woo-push", {
              body: { action: "push_stock", product_id: item.productId },
            }).catch(() => {});
          }
        }
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
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3rem)] -m-6">
      <div className="lg:w-[60%] w-full p-4 overflow-hidden">
        <ProductCatalog
          products={products}
          categories={categories}
          stores={stores}
          onSelectProduct={handleSelectProduct}
          onAddCustomItem={() => setShowCustomItem(true)}
        />
      </div>
      <div className="lg:w-[40%] w-full border-t lg:border-t-0 lg:border-l border-border">
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
