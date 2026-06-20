Add a "POS" option to the store filter dropdown in the dashboard, alongside the existing "All stores" and individual store options. Selecting it scopes every dashboard stat to POS-sourced orders only (orders where `source = 'pos'`), independent of which store they belong to.

## Changes

**1. `src/components/dashboard/DashboardHeader.tsx`**
- Add a `<SelectItem value="pos">POS</SelectItem>` entry right under "All stores" in the store dropdown.
- Update the subtitle line so when `storeId === "pos"` it shows `· POS orders` instead of `· All stores`.

**2. `src/hooks/useDashboardData.ts`**
- Treat `storeId === "pos"` as a special filter: instead of `.eq("store_id", storeId)`, apply `.eq("source", "pos")` to:
  - the current-period orders query (`curQ`)
  - the prior-period orders query (`prevQ`)
  - the all-time orders count query (`allCountQ`)
- Keep the existing `"all"` branch and the per-store branch unchanged.
- Products / stock counts stay global (POS sells from the same product catalog; no change needed).

## Out of scope
- No DB schema changes.
- No changes to Orders page, Analytics, or POS reports — only the main Dashboard's store filter.
- No new "POS-only KPIs"; existing KPIs simply recompute over the POS-filtered order set.