import { useEffect, useState, useCallback } from "react";
import type { BrandSlug } from "./brand";

export interface CartItem {
  product_id: string;
  name: string;
  price: number;
  image_url?: string;
  quantity: number;
  variation_id?: string;
  variation_label?: string;
}

const key = (brand: BrandSlug) => `cart:${brand}`;

function read(brand: BrandSlug): CartItem[] {
  try {
    const raw = localStorage.getItem(key(brand));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(brand: BrandSlug, items: CartItem[]) {
  localStorage.setItem(key(brand), JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(`cart-update:${brand}`));
}

export function useCart(brand: BrandSlug) {
  const [items, setItems] = useState<CartItem[]>(() => read(brand));

  useEffect(() => {
    const h = () => setItems(read(brand));
    window.addEventListener(`cart-update:${brand}`, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(`cart-update:${brand}`, h);
      window.removeEventListener("storage", h);
    };
  }, [brand]);

  const add = useCallback(
    (item: CartItem) => {
      const current = read(brand);
      const idx = current.findIndex(
        (i) => i.product_id === item.product_id && i.variation_id === item.variation_id,
      );
      if (idx >= 0) current[idx].quantity += item.quantity;
      else current.push(item);
      write(brand, current);
    },
    [brand],
  );

  const update = useCallback(
    (product_id: string, variation_id: string | undefined, qty: number) => {
      const current = read(brand)
        .map((i) =>
          i.product_id === product_id && i.variation_id === variation_id
            ? { ...i, quantity: Math.max(0, qty) }
            : i,
        )
        .filter((i) => i.quantity > 0);
      write(brand, current);
    },
    [brand],
  );

  const remove = useCallback(
    (product_id: string, variation_id?: string) => {
      write(
        brand,
        read(brand).filter((i) => !(i.product_id === product_id && i.variation_id === variation_id)),
      );
    },
    [brand],
  );

  const clear = useCallback(() => write(brand, []), [brand]);

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  return { items, add, update, remove, clear, subtotal, count };
}
