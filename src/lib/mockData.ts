export const orders = [
  { id: "ORD-1042", customer: "Rafiq Ahmed", store: "BD Store", source: "WooCommerce", status: "Processing", total: 2450, date: "2026-04-07", items: 3 },
  { id: "ORD-1041", customer: "Sadia Khan", store: "BD Store", source: "WooCommerce", status: "Shipped", total: 1890, date: "2026-04-07", items: 2 },
  { id: "ORD-1040", customer: "Walk-in Customer", store: "Showroom", source: "POS", status: "Completed", total: 750, date: "2026-04-06", items: 1 },
  { id: "ORD-1039", customer: "Nusrat Jahan", store: "Fashion Hub", source: "WooCommerce", status: "Processing", total: 3200, date: "2026-04-06", items: 4 },
  { id: "ORD-1038", customer: "Kamal Hossain", store: "BD Store", source: "WooCommerce", status: "Delivered", total: 5100, date: "2026-04-05", items: 5 },
  { id: "ORD-1037", customer: "Walk-in Customer", store: "Showroom", source: "POS", status: "Completed", total: 1200, date: "2026-04-05", items: 2 },
  { id: "ORD-1036", customer: "Tanvir Alam", store: "Fashion Hub", source: "WooCommerce", status: "Cancelled", total: 980, date: "2026-04-04", items: 1 },
  { id: "ORD-1035", customer: "Mitu Rahman", store: "BD Store", source: "WooCommerce", status: "Shipped", total: 4300, date: "2026-04-04", items: 3 },
];

export const products = [
  { id: "SKU-001", name: "Premium Cotton T-Shirt", sku: "PCT-BLK-M", stock: 45, price: 850, stores: ["BD Store", "Fashion Hub"], status: "In Stock" },
  { id: "SKU-002", name: "Slim Fit Jeans", sku: "SFJ-BLU-32", stock: 12, price: 1950, stores: ["BD Store"], status: "Low Stock" },
  { id: "SKU-003", name: "Leather Wallet", sku: "LW-BRN-01", stock: 0, price: 1200, stores: ["Fashion Hub"], status: "Out of Stock" },
  { id: "SKU-004", name: "Sports Sneakers", sku: "SS-WHT-42", stock: 78, price: 3500, stores: ["BD Store", "Fashion Hub"], status: "In Stock" },
  { id: "SKU-005", name: "Casual Polo Shirt", sku: "CPS-NVY-L", stock: 5, price: 1100, stores: ["BD Store"], status: "Low Stock" },
  { id: "SKU-006", name: "Canvas Backpack", sku: "CB-GRY-01", stock: 33, price: 2200, stores: ["Fashion Hub"], status: "In Stock" },
];

export const revenueData = [
  { date: "Apr 1", online: 12400, pos: 4200 },
  { date: "Apr 2", online: 15800, pos: 3100 },
  { date: "Apr 3", online: 9200, pos: 5600 },
  { date: "Apr 4", online: 18100, pos: 2800 },
  { date: "Apr 5", online: 14300, pos: 6100 },
  { date: "Apr 6", online: 21000, pos: 4900 },
  { date: "Apr 7", online: 16700, pos: 3700 },
];

export const dispatchOrders = orders.filter(o => o.status === "Processing");
