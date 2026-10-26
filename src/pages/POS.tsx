import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { usePosSound } from "@/hooks/usePosSound";
import { useIsMobile } from "@/hooks/use-mobile";
import ProductCatalog from "@/components/pos/ProductCatalog";
import VariationModal from "@/components/pos/VariationModal";
import CartPanel from "@/components/pos/CartPanel";
import CustomItemDialog from "@/components/pos/CustomItemDialog";
import ReturnDialog from "@/components/pos/ReturnDialog";
import HeldCartsDialog from "@/components/pos/HeldCartsDialog";
import RecentOrdersDialog from "@/components/pos/RecentOrdersDialog";
import ShiftDialog from "@/components/pos/ShiftDialog";
import POSToolbar from "@/components/pos/POSToolbar";
import KeyboardShortcutsHelp from "@/components/pos/KeyboardShortcutsHelp";
import type { Product, Cart, CartItem, CustomerData } from "@/components/pos/types";
import { saveOrderItemMeasurements } from "@/lib/measurements";
import { printMeasurementSlip } from "@/components/orders/MeasurementSlipPrint";
import { logAction } from "@/lib/auditLog";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { getEffectiveStock, useGlobalStockEnabled } from "@/lib/stockSettings";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, X } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useActiveBusinessStoreIds,
  scopeStoreIds,
  hasStoreScope,
} from "@/hooks/useActiveBusinessStoreIds";
import { useStoresListState } from "@/hooks/useStoresList";

const normalizeBdPhone = (raw?: string | null) => {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("880") && p.length >= 13) p = p.slice(3);
  if (p.length === 10 && p.startsWith("1")) p = `0${p}`;
  return p;
};

const createEmptyCart = (label: string): Cart => ({
  id: crypto.randomUUID(),
  label,
  items: [],
  customer: null,
  fulfillment: "walkin",
  shippingAddress: "",
  pathaoZone: "",
  discount: 0,
  discountType: "flat",
  shippingFee: 0,
  payments: [],
  notes: "",
  taxRate: 0,
});

const POS = () => {
  const { symbol } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();

  // Tenant scope (issue #16): fail closed — empty scope means no reads/writes.
  // `settled` distinguishes "scope still resolving" (loading UI) from "settled
  // to zero stores" (no-stores UI), so we never flash fail-closed prematurely.
  // Ids come from the ONE seam (its contract: pages never re-derive them);
  // the stores list itself is still needed here for the picker's names.
  const { stores: businessStores, settled: scopeSettled } = useStoresListState();
  const businessStoreIds = useActiveBusinessStoreIds();
  const hasScope = hasStoreScope(businessStoreIds);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string; parent_id: string | null; store_id: string | null }[]>([]);
  const [productCatMap, setProductCatMap] = useState<Map<string, Set<string>>>(new Map());
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerData[]>([]);
  const globalStockEnabled = useGlobalStockEnabled();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [carts, setCarts] = useState<Cart[]>([createEmptyCart("Cart 1")]);
  const [activeCartId, setActiveCartId] = useState(carts[0].id);
  const [cartCounter, setCartCounter] = useState(2);

  const [selectedStoreId, setSelectedStoreId] = useState("default");
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [heldCount, setHeldCount] = useState(0);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const isMobile = useIsMobile();

  const { scanBeep, addBeep, errorBeep, successChime } = usePosSound(soundEnabled);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load current open shift — scoped to the active business's stores
  useEffect(() => {
    if (!user || !hasScope) {
      // Fail closed: a shift from a previous scope must not survive a scope loss
      setCurrentShift(null);
      return;
    }
    scopeStoreIds(
      supabase
        .from("pos_shifts" as any)
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "open"),
      businessStoreIds,
    )
      .order("opened_at", { ascending: false })
      .limit(1)
      .then(({ data }: any) => {
        if (data && data.length > 0) setCurrentShift(data[0]);
      });
  }, [user, businessStoreIds, hasScope]);

  // Load held count — scoped to the active business's stores
  useEffect(() => {
    if (!hasScope) {
      setHeldCount(0);
      return;
    }
    scopeStoreIds(
      supabase.from("held_carts" as any).select("id", { count: "exact", head: true }),
      businessStoreIds,
    ).then(({ count }: any) => setHeldCount(count || 0));
  }, [showHeld, businessStoreIds, hasScope]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Skip if typing in input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case "F1":
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        case "F3":
          e.preventDefault();
          setShowCustomItem(true);
          break;
        case "F5":
          e.preventDefault();
          holdCurrentCart();
          break;
        case "F6":
          e.preventDefault();
          setShowHeld(true);
          break;
        case "F7":
          e.preventDefault();
          setShowReturn(true);
          break;
        case "F8":
          e.preventDefault();
          setShowRecent(true);
          break;
        case "F9":
          e.preventDefault();
          setShowShift(true);
          break;
        case "F11":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "?":
          setShowShortcuts(true);
          break;
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeCartId, carts]);

  // Barcode scanner
  useBarcodeScanner(useCallback(async (barcode: string) => {
    scanBeep();
    const product = products.find(
      (p) => (p as any).barcode === barcode || p.sku === barcode
    );
    if (product) {
      // product came from the business-scoped catalog, so its variations are
      // transitively scoped by product_id
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
        if (getEffectiveStock(product, globalStockEnabled).outOfStock) {
          errorBeep();
          toast({ title: "Out of stock", description: product.name, variant: "destructive" });
          return;
        }
        addToCart({
          uid: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          qty: 1,
          customTailoring: false,
        });
        addBeep();
        toast({ title: `Added: ${product.name}` });
      }
    } else {
      // Standalone barcode lookup: bound it to the business-scoped product
      // catalog so a cross-business variation barcode cannot resolve
      if (!hasScope) {
        errorBeep();
        toast({ title: "Product not found", description: `No match for barcode: ${barcode}`, variant: "destructive" });
        return;
      }
      const { data: varMatch } = await supabase
        .from("product_variations")
        .select("id, name, price, product_id, barcode, stock_quantity, manage_stock, stock_status")
        .eq("barcode", barcode)
        .in("product_id", products.map((p) => p.id))
        .limit(1);

      if (varMatch && varMatch.length > 0) {
        const v = varMatch[0];
        if (getEffectiveStock(v, globalStockEnabled).outOfStock) {
          errorBeep();
          toast({ title: "Out of stock", description: v.name, variant: "destructive" });
          return;
        }
        const parentProduct = products.find((p) => p.id === v.product_id);
        addToCart({
          uid: crypto.randomUUID(),
          productId: v.product_id,
          name: parentProduct?.name || "Product",
          price: Number(v.price),
          qty: 1,
          variationId: v.id,
          variationLabel: v.name,
          customTailoring: false,
        });
        addBeep();
        toast({ title: `Added: ${parentProduct?.name} - ${v.name}` });
      } else {
        errorBeep();
        toast({ title: "Product not found", description: `No match for barcode: ${barcode}`, variant: "destructive" });
      }
    }
  }, [products, scanBeep, addBeep, errorBeep, globalStockEnabled, toast, hasScope]));

  // Catalog load — all reads scoped to the active business's stores.
  // Fail closed: never query with an empty scope.
  useEffect(() => {
    if (!hasScope) {
      // Scope settled to zero stores: clear any previous tenant's data
      setProducts([]);
      setCategories([]);
      setStores([]);
      setProductCatMap(new Map());
      setLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      const [prodRes, catRes, pcRes] = await Promise.all([
        scopeStoreIds(
          supabase.from("products").select("id, name, sku, price, stock_quantity, image_url, category, description, store_id, created_at, barcode, is_featured, sales_count, manage_stock, stock_status").eq("is_active", true).order("name"),
          businessStoreIds,
        ),
        scopeStoreIds(
          supabase.from("categories").select("id, name, parent_id, store_id").order("name"),
          businessStoreIds,
        ),
        supabase.from("product_categories").select("product_id, category_id"),
      ]);
      if (!active) return;
      const prods = (prodRes.data || []) as any[];
      setProducts(prods);
      setCategories((catRes.data || []) as any);
      // Store list comes straight from the business scope seam (already
      // scoped), so no separate stores query is needed
      setStores(businessStores.map((s) => ({ id: s.id, name: s.name })));
      // product_categories has no store_id; keep only links whose product is
      // in the already-scoped catalog (transitive scoping)
      const scopedProductIds = new Set(prods.map((p: any) => p.id));
      const map = new Map<string, Set<string>>();
      (pcRes.data || []).forEach((pc: any) => {
        if (!scopedProductIds.has(pc.product_id)) return;
        if (!map.has(pc.product_id)) map.set(pc.product_id, new Set());
        map.get(pc.product_id)!.add(pc.category_id);
      });
      setProductCatMap(map);
      setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
  }, [businessStoreIds, businessStores, hasScope]);

  const handleSelectProduct = (p: Product) => {
    setSelectedProduct(p);
    setShowVariationModal(true);
  };

  const addToCart = useCallback((item: CartItem) => {
    addBeep();
    setCarts((prev) =>
      prev.map((c) =>
        c.id === activeCartId ? { ...c, items: [...c.items, item] } : c
      )
    );
  }, [activeCartId, addBeep]);

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

  const holdCurrentCart = useCallback(async () => {
    const cart = carts.find((c) => c.id === activeCartId);
    if (!cart || cart.items.length === 0) {
      toast({ title: "Cart is empty", variant: "destructive" });
      return;
    }

    // Fail closed: the held cart's store must belong to the active business
    const cartStoreId = cart.storeId || (selectedStoreId !== "default" ? selectedStoreId : null);
    if (!cartStoreId || !businessStoreIds.includes(cartStoreId)) {
      toast({ title: "Cannot hold cart", description: "No active business store selected", variant: "destructive" });
      return;
    }

    await supabase.from("held_carts" as any).insert({
      label: cart.label,
      cart_data: cart,
      customer_name: cart.customer?.name || null,
      customer_phone: cart.customer?.phone || null,
      notes: cart.notes || null,
      store_id: cartStoreId,
      held_by: user?.id || null,
    });

    // Reset current cart
    removeCart(cart.id);
    toast({ title: `${cart.label} held` });
  }, [carts, activeCartId, selectedStoreId, user, businessStoreIds, toast, removeCart]);

  const recallCart = useCallback((cart: Cart) => {
    setCarts((prev) => [...prev, cart]);
    setActiveCartId(cart.id);
  }, []);

  const searchCustomers = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setCustomers([]); return; }
    if (!hasScope) { setCustomers([]); return; }
    const { data } = await scopeStoreIds(
      supabase
        .from("customers")
        .select("id, name, phone, email, address, city, zone, area")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`),
      businessStoreIds,
    ).limit(10);
    setCustomers((data || []) as CustomerData[]);
  }, [businessStoreIds, hasScope]);

  const completeOrder = useCallback(async (cart: Cart): Promise<string> => {
    // Fail closed: no order may be placed without an active business scope
    if (!hasScope) {
      toast({ title: "Cannot complete order", description: "No active business store available", variant: "destructive" });
      return "";
    }

    // The order's store must belong to the active business
    const orderStoreId = cart.storeId || (selectedStoreId !== "default" ? selectedStoreId : null);
    if (!orderStoreId || !businessStoreIds.includes(orderStoreId)) {
      toast({ title: "Cannot complete order", description: "Select a store belonging to the active business", variant: "destructive" });
      return "";
    }

    const subtotal = cart.items.reduce((s, i) => {
      const lineTotal = i.price * i.qty;
      const itemDiscount = i.discountType === "percent"
        ? lineTotal * (i.discountValue || 0) / 100
        : (i.discountValue || 0);
      return s + lineTotal - itemDiscount;
    }, 0);

    const cartDiscount = cart.discountType === "percent"
      ? subtotal * cart.discount / 100
      : cart.discount;

    const afterDiscount = subtotal - cartDiscount;
    const taxAmount = afterDiscount * cart.taxRate / 100;
    const total = afterDiscount + taxAmount + (cart.fulfillment === "delivery" ? cart.shippingFee : 0);

    const { data: genNum, error: genErr } = await supabase.rpc("generate_pos_order_number" as any, { p_store_id: orderStoreId, p_source: "pos" });
    if (genErr) console.error("generate_pos_order_number failed", genErr);
    const orderNumber = (genNum as string) || `POS-${Date.now().toString(36).toUpperCase()}`;

    const normalizedCustomerPhone = normalizeBdPhone(cart.customer?.phone);
    let customerId: string | null = cart.customer?.id || null;
    if (cart.customer && !cart.customer.id && cart.customer.name) {
      if (normalizedCustomerPhone) {
        // Customer lookup/update scoped to the order's (validated) store
        const { data: existing } = await supabase
          .from("customers")
          .select("id")
          .eq("phone", normalizedCustomerPhone)
          .eq("store_id", orderStoreId)
          .maybeSingle();
        if (existing) {
          customerId = existing.id;
          await supabase.from("customers").update({
            name: cart.customer.name,
            address: cart.customer.address || null,
            phone: normalizedCustomerPhone,
          }).eq("id", existing.id).eq("store_id", orderStoreId);
        }
      }
      if (!customerId) {
        const { data: newCust } = await supabase
          .from("customers")
          .insert({ name: cart.customer.name, phone: normalizedCustomerPhone, address: cart.customer.address || null, source: 'pos', store_id: orderStoreId })
          .select("id")
          .single();
        if (newCust) customerId = newCust.id;
      }
    }

    const totalPaid = cart.payments.reduce((s, p) => s + p.amount, 0);
    const dueAmount = Math.max(0, total - totalPaid);
    const paymentStatus = dueAmount > 0 ? "partial" : "paid";
    const needsFulfillment = cart.fulfillment === "delivery" || cart.fulfillment === "pickup";
    const orderStatus = needsFulfillment ? "processing" : "delivered";

    const { data: order } = await supabase
      .from("orders")
      .insert({
        order_number: orderNumber,
        source: "pos",
        status: orderStatus,
        payment_status: paymentStatus,
        subtotal,
        discount: cartDiscount,
        shipping_cost: cart.fulfillment === "delivery" ? cart.shippingFee : 0,
        total,
        tax_amount: taxAmount,
        customer_id: customerId,
        customer_name: cart.customer?.name || null,
        customer_phone: normalizedCustomerPhone,
        customer_address: cart.customer?.address || null,
        customer_city: null,
        notes: cart.notes || null,
        store_id: orderStoreId,
        salesperson_id: cart.salespersonId || user?.id || null,
        salesperson_name: cart.salespersonName || user?.email || null,
        amount_to_collect: dueAmount > 0 ? dueAmount : 0,
        fulfillment_type: cart.fulfillment || "walkin",
        pathao_recipient_city: cart.pathaoCityId || null,
        pathao_recipient_zone: cart.pathaoZoneId || null,
      })
      .select("id")
      .single();

    if (order) {
      // Order placed timeline event
      await addOrderTimeline({
        order_id: order.id,
        event: "created",
        description: `Order placed via POS — Total ${symbol}${total.toLocaleString()}`,
        metadata: { source: "pos", total, item_count: cart.items.length, payment_status: paymentStatus },
      });
      await logAction("create", "order", order.id, {
        order_number: orderNumber, source: "pos", total, payment_status: paymentStatus,
        item_count: cart.items.length,
      });

      const items = cart.items.map((i) => ({
        order_id: order.id,
        product_id: i.isCustomItem ? null : i.productId,
        product_name: i.name + (i.variationLabel ? ` - ${i.variationLabel}` : ""),
        quantity: i.qty,
        unit_price: i.price,
        line_total: i.price * i.qty,
        discount: i.discountType === "percent"
          ? (i.price * i.qty * (i.discountValue || 0) / 100)
          : (i.discountValue || 0),
      }));
      const { data: insertedItems } = await supabase.from("order_items").insert(items).select("id");

      // Persist measurements per inserted item
      let hasMeasurements = false;
      if (insertedItems) {
        for (let idx = 0; idx < cart.items.length; idx++) {
          const cartItem = cart.items[idx];
          const dbItem = insertedItems[idx];
          if (cartItem.measurementGroups && cartItem.measurementGroups.length > 0 && dbItem) {
            hasMeasurements = true;
            await saveOrderItemMeasurements(order.id, dbItem.id, cartItem.measurementGroups.map((g) => ({
              groupName: g.groupName,
              displayFormat: g.displayFormat,
              unit: g.unit,
              values: g.values,
              notes: g.notes,
              source: "pos",
            })));
          }
        }
      }

      // Toast with print action if measurements were captured
      if (hasMeasurements) {
        toast({
          title: "Order completed with measurements",
          description: "Click to print measurement slip",
          action: (
            <button
              onClick={() => printMeasurementSlip(order.id, businessStoreIds)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Print Slip
            </button>
          ) as any,
        });
      }

      if (cart.payments.length > 0) {
        const payments = cart.payments.map((p) => ({
          order_id: order.id,
          method: p.method,
          amount: p.amount,
        }));
        await supabase.from("order_payments").insert(payments);
        await addOrderTimeline(
          cart.payments.map((p) => ({
            order_id: order.id,
            event: "payment_logged",
            description: `Payment of ${symbol}${p.amount.toLocaleString()} via ${p.method}`,
            metadata: { method: p.method, amount: p.amount },
          }))
        );
        await logAction("create", "order_payment", order.id, {
          order_number: orderNumber, payments: cart.payments.map((p) => ({ method: p.method, amount: p.amount })),
        });
      }

      // Update shift stats
      if (currentShift) {
        const cashPaid = cart.payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
        const cardPaid = cart.payments.filter((p) => p.method === "card").reduce((s, p) => s + p.amount, 0);
        const bkashPaid = cart.payments.filter((p) => p.method === "bkash").reduce((s, p) => s + p.amount, 0);
        const bankPaid = cart.payments.filter((p) => p.method === "bank").reduce((s, p) => s + p.amount, 0);

        const updated = {
          ...currentShift,
          total_sales: currentShift.total_sales + total,
          transaction_count: currentShift.transaction_count + 1,
          cash_sales: currentShift.cash_sales + cashPaid,
          card_sales: currentShift.card_sales + cardPaid,
          bkash_sales: currentShift.bkash_sales + bkashPaid,
          bank_sales: currentShift.bank_sales + bankPaid,
        };

        // Shift update is scoped: only shift rows belonging to the active
        // business's stores may be written
        await scopeStoreIds(
          supabase.from("pos_shifts" as any).update({
            total_sales: updated.total_sales,
            transaction_count: updated.transaction_count,
            cash_sales: updated.cash_sales,
            card_sales: updated.card_sales,
            bkash_sales: updated.bkash_sales,
            bank_sales: updated.bank_sales,
          }).eq("id", currentShift.id),
          businessStoreIds,
        );

        setCurrentShift(updated);
      }

      // Stock reduction — variations track their own stock independently of the parent product.
      // Every write is validated against the business scope before executing.
      for (const item of cart.items) {
        if (item.isCustomItem || !item.productId) continue;
        // Parent product must belong to the active business before any stock write
        const { data: prod } = await supabase.from("products").select("stock_quantity, woo_product_id, store_id, manage_stock").eq("id", item.productId).single();
        if (!prod || !prod.store_id || !businessStoreIds.includes(prod.store_id)) continue;
        if (item.variationId) {
          const { data: v } = await supabase.from("product_variations").select("stock_quantity, manage_stock").eq("id", item.variationId).eq("product_id", item.productId).single();
          if (v && (globalStockEnabled || v.manage_stock === true)) {
            await supabase.from("product_variations").update({ stock_quantity: Math.max(0, v.stock_quantity - item.qty) }).eq("id", item.variationId).eq("product_id", item.productId);
          }
          // Still push parent product stock to Woo so the linked store reflects the change
          if (prod.woo_product_id) {
            supabase.functions.invoke("woo-push", {
              body: { action: "push_stock", product_id: item.productId },
            }).catch(() => {});
          }
        } else {
          if (globalStockEnabled || prod.manage_stock === true) {
            await supabase.from("products").update({ stock_quantity: Math.max(0, prod.stock_quantity - item.qty) }).eq("id", item.productId).in("store_id", businessStoreIds);
            if (prod.woo_product_id) {
              supabase.functions.invoke("woo-push", {
                body: { action: "push_stock", product_id: item.productId },
              }).catch(() => {});
            }
          }
        }
      }
    }

    successChime();

    // Reset cart
    setCarts((prev) => {
      const next = prev.map((c) => (c.id === cart.id ? createEmptyCart(c.label) : c));
      setActiveCartId(next.find((c) => c.label === cart.label)?.id || next[0].id);
      return next;
    });

    return orderNumber;
  }, [selectedStoreId, user, currentShift, successChime, globalStockEnabled, businessStoreIds, hasScope, toast, symbol]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  // Active cart summary for mobile floating bar
  const activeCart = carts.find((c) => c.id === activeCartId);
  const mobileCartCount = activeCart?.items.reduce((s, i) => s + i.qty, 0) || 0;
  const mobileCartTotal = (() => {
    if (!activeCart) return 0;
    const sub = activeCart.items.reduce((s, i) => {
      const lt = i.price * i.qty;
      const id = i.discountType === "percent" ? lt * (i.discountValue || 0) / 100 : (i.discountValue || 0);
      return s + lt - id;
    }, 0);
    const cd = activeCart.discountType === "percent" ? sub * activeCart.discount / 100 : activeCart.discount;
    const after = sub - cd;
    const tax = after * activeCart.taxRate / 100;
    return after + tax + (activeCart.fulfillment === "delivery" ? activeCart.shippingFee : 0);
  })();

  // Auto-close mobile cart when items are cleared (e.g. after order completion)
  useEffect(() => {
    if (isMobile && mobileCartOpen && mobileCartCount === 0) {
      setMobileCartOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileCartCount, isMobile]);

  // Scope not settled yet: treat as loading — never flash the fail-closed UI
  // while the business's store list is still resolving.
  if (!scopeSettled || loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-5rem)] text-muted-foreground">
        <div className="animate-pulse text-lg font-heading">Loading POS...</div>
      </div>
    );
  }

  // Fail closed: scope settled to zero stores — no tenant reads or writes.
  if (!hasScope) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-5rem)] gap-2 text-muted-foreground">
        <div className="text-lg font-heading">No stores available</div>
        <div className="text-sm">The active business has no stores. Select a business with at least one store to use POS.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)] md:h-[calc(100vh-3rem)] -m-4 lg:-m-6 pb-16 lg:pb-0">
      <POSToolbar
        stores={stores}
        selectedStoreId={selectedStoreId}
        onStoreChange={setSelectedStoreId}
        salespersonName={user?.email || ""}
        onOpenHeld={() => setShowHeld(true)}
        onHoldCurrent={holdCurrentCart}
        onOpenReturn={() => setShowReturn(true)}
        onOpenRecent={() => setShowRecent(true)}
        onOpenShift={() => setShowShift(true)}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
        shiftOpen={!!currentShift}
        heldCount={heldCount}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Products: full width on mobile, 60% on desktop */}
        <div className="md:w-[60%] w-full p-3 md:p-4 overflow-hidden">
          <ProductCatalog
            products={products}
            categories={categories}
            productCatMap={productCatMap}
            stores={stores}
            onSelectProduct={handleSelectProduct}
            onAddCustomItem={() => setShowCustomItem(true)}
            searchInputRef={searchInputRef}
          />
        </div>
        {/* Cart: hidden on mobile (opens via sheet), inline on desktop */}
        <div className="hidden md:block md:w-[40%] border-l border-border">
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
      </div>

      {/* Mobile sticky cart bar */}
      {isMobile && (
        <div className="md:hidden fixed bottom-16 inset-x-0 z-40 px-3 pb-2 pt-1 pointer-events-none">
          <Button
            onClick={() => setMobileCartOpen(true)}
            size="lg"
            className="w-full h-14 shadow-2xl shadow-primary/30 gap-3 pointer-events-auto rounded-xl"
          >
            <div className="relative">
              <ShoppingCart className="h-5 w-5" />
              {mobileCartCount > 0 && (
                <Badge className="absolute -top-2 -right-2 h-5 min-w-5 px-1 text-[10px] bg-primary-foreground text-primary border-0 flex items-center justify-center">
                  {mobileCartCount}
                </Badge>
              )}
            </div>
            <span className="flex-1 text-left">
              {mobileCartCount === 0 ? "Cart Empty" : `${mobileCartCount} ${mobileCartCount === 1 ? "item" : "items"}`}
            </span>
            <span className="font-heading text-base">{symbol}{mobileCartTotal.toLocaleString()}</span>
          </Button>
        </div>
      )}

      {/* Mobile cart sheet */}
      <Sheet open={isMobile && mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <SheetContent side="bottom" className="h-[100dvh] p-0 flex flex-col gap-0 [&>button]:hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
            <span className="text-sm font-semibold">Cart</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileCartOpen(false)} aria-label="Close cart">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
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
        </SheetContent>
      </Sheet>

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
      <ReturnDialog
        open={showReturn}
        onClose={() => setShowReturn(false)}
      />
      <HeldCartsDialog
        open={showHeld}
        onClose={() => setShowHeld(false)}
        onRecall={recallCart}
      />
      <RecentOrdersDialog
        open={showRecent}
        onClose={() => setShowRecent(false)}
      />
      <ShiftDialog
        open={showShift}
        onClose={() => setShowShift(false)}
        currentShift={currentShift}
        onShiftChange={setCurrentShift}
      />
      <KeyboardShortcutsHelp
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </div>
  );
};

export default POS;
