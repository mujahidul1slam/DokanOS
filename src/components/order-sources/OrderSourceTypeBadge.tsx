import { Badge } from "@/components/ui/badge";
import { orderSourceLabel, orderSourceTypeInfo } from "@/lib/orderSources";

/**
 * Type badge for an order source. Colour reinforces the label — the text
 * label always carries the meaning (never colour alone).
 */
const TYPE_STYLES: Record<string, string> = {
  woocommerce: "bg-violet-500/15 text-violet-400 border-violet-500/20 hover:bg-violet-500/25",
  storefront: "bg-teal-500/15 text-teal-400 border-teal-500/20 hover:bg-teal-500/25",
  showroom: "bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25",
  physical_store: "bg-orange-500/15 text-orange-400 border-orange-500/20 hover:bg-orange-500/25",
  facebook: "bg-sky-500/15 text-sky-400 border-sky-500/20 hover:bg-sky-500/25",
  instagram: "bg-pink-500/15 text-pink-400 border-pink-500/20 hover:bg-pink-500/25",
  whatsapp: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25",
  manual: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/25",
};

export function OrderSourceTypeBadge({ type }: { type: string }) {
  const info = orderSourceTypeInfo(type);
  return (
    <Badge variant="outline" className={TYPE_STYLES[type] ?? TYPE_STYLES.manual}>
      {info ? info.label : orderSourceLabel(type)}
      {info?.holdsStockByDefault && <span className="sr-only"> (holds stock)</span>}
    </Badge>
  );
}
