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

export interface MeasurementGroupCapture {
  groupId: string;
  groupName: string;
  displayFormat: "label_value" | "dash_separated";
  unit: string;
  values: { name: string; value: string }[];
  notes?: string;
}

// Kept for backwards compatibility (legacy fields)
export interface CustomMeasurements {
  chest?: string;
  length?: string;
  sleeves?: string;
  shoulders?: string;
  waist?: string;
  notes?: string;
}

export interface CartItem {
  uid: string;
  productId: string;
  variationId?: string;
  name: string;
  variationLabel?: string;
  price: number;
  originalPrice?: number; // for inline price edits
  qty: number;
  customTailoring: boolean;
  measurements?: CustomMeasurements;
  measurementGroups?: MeasurementGroupCapture[];
  isCustomItem?: boolean;
  discountType?: "flat" | "percent";
  discountValue?: number;
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
  fulfillment: "walkin" | "pickup" | "delivery";
  shippingAddress: string;
  pathaoZone: string;
  pathaoCityId?: number;
  pathaoZoneId?: number;
  pathaoAreaId?: number;
  discount: number;
  discountType: "flat" | "percent";
  shippingFee: number;
  payments: Payment[];
  notes: string;
  taxRate: number; // percentage
  salespersonId?: string;
  salespersonName?: string;
  storeId?: string;
}

export interface HeldCart {
  id: string;
  label: string;
  cart_data: Cart;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface PosReturn {
  id: string;
  order_id: string | null;
  return_number: string;
  items: any[];
  reason: string | null;
  refund_amount: number;
  refund_method: string;
  restock: boolean;
  notes: string | null;
  created_at: string;
}

export interface PosShift {
  id: string;
  user_id: string;
  user_email: string | null;
  store_id: string | null;
  status: string;
  opening_float: number;
  closing_balance: number | null;
  expected_balance: number | null;
  total_sales: number;
  total_returns: number;
  transaction_count: number;
  cash_sales: number;
  card_sales: number;
  bkash_sales: number;
  bank_sales: number;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface RecentOrder {
  id: string;
  order_number: string;
  total: number;
  status: string;
  payment_status: string;
  created_at: string;
  customer_name?: string;
  source: string;
}
