import { Globe, Wifi, WifiOff } from "lucide-react";

const stores = [
  { name: "BD Store", url: "bdstore.com", status: "Connected", orders: 847, products: 98 },
  { name: "Fashion Hub", url: "fashionhub.com.bd", status: "Connected", orders: 195, products: 58 },
  { name: "Showroom (POS)", url: "—", status: "Active", orders: 312, products: 156 },
];

const Stores = () => (
  <div className="space-y-6">
    <div>
      <h1 className="font-heading text-2xl font-semibold">Stores</h1>
      <p className="text-sm text-muted-foreground">Connected storefronts & channels</p>
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {stores.map((store) => (
        <div key={store.name} className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                <Globe className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-heading text-sm font-semibold text-card-foreground">{store.name}</p>
                <p className="text-xs text-muted-foreground">{store.url}</p>
              </div>
            </div>
            {store.status === "Connected" || store.status === "Active" ? (
              <Wifi className="h-4 w-4 text-success" />
            ) : (
              <WifiOff className="h-4 w-4 text-destructive" />
            )}
          </div>
          <div className="flex gap-6">
            <div>
              <p className="font-heading text-lg font-semibold text-card-foreground">{store.orders}</p>
              <p className="text-xs text-muted-foreground">Orders</p>
            </div>
            <div>
              <p className="font-heading text-lg font-semibold text-card-foreground">{store.products}</p>
              <p className="text-xs text-muted-foreground">Products</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default Stores;
