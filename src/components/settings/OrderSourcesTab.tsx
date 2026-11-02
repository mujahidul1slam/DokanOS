import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Store } from "lucide-react";

/**
 * Task 6 (spec §2): the old global channel lookup (`legacy_order_channels`)
 * died with the per-brand order source model — manual channels are now
 * user-created order sources, one row per brand. This panel points at the new
 * page instead of editing the dead lookup; the table itself is dropped in the
 * contract phase (Task 16).
 */
const OrderSourcesTab = () => {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold mb-1">Order Sources</h2>
        <p className="text-sm text-muted-foreground">
          Order sources are now managed per brand — WooCommerce, storefront,
          showroom, social channels, and your own manual channels like "Phone
          Orders" or "Wholesale". Each source carries its own connection and
          sync settings, and every order is attributed to one.
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-4">
        <Store className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm text-muted-foreground flex-1">
          The old global channel list is retired and will be removed in the
          contract phase. Manage sources on the Order Sources page.
        </p>
        <Button size="sm" asChild>
          <Link to="/order-sources">Open Order Sources</Link>
        </Button>
      </div>
    </div>
  );
};

export default OrderSourcesTab;
