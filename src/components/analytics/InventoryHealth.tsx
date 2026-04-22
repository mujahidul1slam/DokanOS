import { AlertTriangle, Package, TrendingDown, Archive } from "lucide-react";

interface Props {
  totalSkus: number;
  lowStock: number;
  outOfStock: number;
  deadStock: number;
  inventoryValue: number;
  turnoverRatio: number;
  topSlowMovers: { name: string; stock: number; lastSold?: string | null }[];
}

const InventoryHealth = ({ totalSkus, lowStock, outOfStock, deadStock, inventoryValue, turnoverRatio, topSlowMovers }: Props) => (
  <div className="rounded-lg border border-border bg-card p-5">
    <div className="mb-4">
      <h2 className="font-heading text-sm font-medium text-card-foreground">Inventory Health</h2>
      <p className="text-xs text-muted-foreground mt-0.5">Stock value, turnover, and dead inventory</p>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Package className="h-3.5 w-3.5" /> SKUs</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{totalSkus}</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">Stock Value</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">৳{Math.round(inventoryValue).toLocaleString()}</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" /> Turnover</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{turnoverRatio.toFixed(2)}x</p>
      </div>
      <div className="rounded-md bg-amber-500/10 p-3 border border-amber-500/20">
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Low Stock</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{lowStock}</p>
      </div>
      <div className="rounded-md bg-destructive/10 p-3 border border-destructive/20">
        <div className="flex items-center gap-1.5 text-xs text-destructive">Out of Stock</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{outOfStock}</p>
      </div>
      <div className="rounded-md bg-muted/40 p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Archive className="h-3.5 w-3.5" /> Dead Stock</div>
        <p className="mt-1 font-heading text-xl font-semibold text-foreground">{deadStock}</p>
      </div>
    </div>

    <div>
      <h3 className="text-xs font-medium text-muted-foreground mb-2">Slow Movers (no sales, in-stock)</h3>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {topSlowMovers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">All products selling well 🎉</div>
        ) : (
          topSlowMovers.slice(0, 5).map((p, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="truncate text-foreground">{p.name}</span>
              <span className="text-muted-foreground shrink-0 ml-2">{p.stock} in stock</span>
            </div>
          ))
        )}
      </div>
    </div>
  </div>
);

export default InventoryHealth;
