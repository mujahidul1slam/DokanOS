export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  image_url: string | null;
  category: string | null;
  description: string | null;
}

export interface Variation {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price: number;
  stock_quantity: number;
  attributes: Record<string, string>[] | string;
}

export interface CustomMeasurements {
  chest: string;
  length: string;
  sleeves: string;
  shoulders: string;
  waist: string;
  notes: string;
}

export interface CartItem {
  uid: string; // unique per cart line
  productId: string;
  variationId?: string;
  name: string;
  variationLabel?: string;
  price: number;
  qty: number;
  customTailoring: boolean;
  measurements?: CustomMeasurements;
  isCustomItem?: boolean;
}

export interface Payment {
  id: string;
  method: "cash" | "bkash" | "card" | "bank";
  amount: number;
}

export interface CustomerData {
  id?: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  zone?: string;
  area?: string;
}

export interface Cart {
  id: string;
  label: string;
  items: CartItem[];
  customer: CustomerData | null;
  fulfillment: "pickup" | "delivery";
  shippingAddress: string;
  pathaoZone: string;
  discount: number;
  shippingFee: number;
  payments: Payment[];
  notes: string;
}
