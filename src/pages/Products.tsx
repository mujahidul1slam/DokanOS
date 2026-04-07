import { Search, Plus } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { products } from "@/lib/mockData";

const Products = () => (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">Central product catalog</p>
      </div>
      <button className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <Plus className="h-4 w-4" /> Add Product
      </button>
    </div>

    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        placeholder="Search products or SKUs..."
        className="h-9 w-full rounded-md border border-border bg-secondary pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>

    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">SKU</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Stock</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Price</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Stores</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/50">
              <td className="px-4 py-3 font-medium text-foreground">{p.name}</td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.sku}</td>
              <td className="px-4 py-3 text-right text-foreground">{p.stock}</td>
              <td className="px-4 py-3 text-right font-medium text-foreground">৳{p.price.toLocaleString()}</td>
              <td className="px-4 py-3 text-muted-foreground">{p.stores.join(", ")}</td>
              <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default Products;
