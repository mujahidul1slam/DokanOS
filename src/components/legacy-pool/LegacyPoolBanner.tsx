import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { hasStoreScope } from "@/hooks/useActiveBusinessStoreIds";
import { fetchPoolCounts, type PoolCounts } from "@/lib/legacyPool";

interface LegacyPoolBannerProps {
  /**
   * The page's tenant scope (useActiveBusinessStoreIds). The banner rides the
   * same seam and fails closed with it: no store scope → no queries at all,
   * so the reports page keeps its zero-operational-reads contract.
   */
  storeIds: string[];
}

/**
 * Task 15 "visible in reports context": a compact heads-up for the reports
 * surfaces (Analytics) while the legacy pool still holds unattributed rows.
 * Renders nothing when the pool is empty or unreadable — reports pages stay
 * clean before the cutover migration and after the pool is drained.
 */
export default function LegacyPoolBanner({ storeIds }: LegacyPoolBannerProps) {
  const [counts, setCounts] = useState<PoolCounts | null>(null);

  useEffect(() => {
    if (!hasStoreScope(storeIds)) {
      setCounts(null);
      return;
    }
    let active = true;
    fetchPoolCounts()
      .then((next) => {
        if (active) setCounts(next);
      })
      .catch(() => {
        // The pool surface is advisory here — never disturb the reports page.
        if (active) setCounts(null);
      });
    return () => {
      active = false;
    };
  }, [storeIds]);

  const total = (counts?.orders ?? 0) + (counts?.customers ?? 0);
  if (total === 0) return null;

  return (
    <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="text-sm">
          <span className="font-medium">Legacy / unattributed pool:</span>{" "}
          {counts?.orders ?? 0} order{(counts?.orders ?? 0) === 1 ? "" : "s"} and{" "}
          {counts?.customers ?? 0} customer
          {(counts?.customers ?? 0) === 1 ? "" : "s"} are not attributed to a
          brand yet, so they sit outside the brand-level figures.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/legacy-pool">Review pool</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
