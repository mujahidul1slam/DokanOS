import { AlertTriangle } from "lucide-react";
import { getEffectiveStock } from "@/lib/stockSettings";
import type { ProductLite } from "@/hooks/useDashboardData";

interface LowStockAlertProps {
  products: ProductLite[];
  lowStockCount: number;
  globalStockEnabled: boolean;
}

const LowStockAlert = ({ products, lowStockCount, globalStockEnabled }: LowStockAlertProps) => {
  if (products.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <h2 className="font-heading text-sm font-medium text-foreground">
          Low Stock Alert ({lowStockCount} products)
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {products.map((p) => {
          const stock = getEffectiveStock(p, globalStockEnabled);
          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.sku || "No SKU"}</p>
              </div>
              <span
                className={`text-sm font-semibold ${stock.quantity <= 3 ? "text-destructive" : "text-amber-400"}`}
              >
                {stock.quantity} left
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LowStockAlert;
