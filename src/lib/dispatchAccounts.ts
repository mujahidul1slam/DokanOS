/**
 * Pure helpers for branded Pathao Account dispatch (issue #22).
 *
 * Glossary terms (see GLOSSARY.md):
 * - Brand: commercial identity; owns a Woo store binding (`woo_store_id`).
 * - Selling point: the place/channel an order was taken at.
 * - Pathao account: the Pathao merchant account used to dispatch an order
 *   (courier credentials + pickup configuration). Avoid "Pathao store".
 *
 * A per-brand default Pathao Account lives in `pathao_store_links`, keyed by
 * the brand's `woo_store_id` ({ pathao_integration_id, default_pathao_store_id }).
 * Labels come from `pathao_integrations_safe` (never raw `pathao_integrations`,
 * whose credentials are admin-only) and active `pathao_stores` rows scoped to
 * the integration.
 */

export interface PathaoIntegrationRow {
  id: string | null;
  name: string | null;
  is_active?: boolean | null;
}

export interface PathaoStoreRow {
  pathao_store_id: number;
  store_name: string;
  integration_id: string | null;
  is_active?: boolean | null;
}

export interface PathaoStoreLinkRow {
  woo_store_id: string;
  pathao_integration_id: string | null;
  default_pathao_store_id: number | null;
}

/** One selectable Pathao Account: credentials (integration) + pickup store. */
export interface PathaoAccountOption {
  /** Stable selection key: `${integrationId}:${pathaoStoreId}`. */
  key: string;
  integrationId: string | null;
  accountName: string;
  pathaoStoreId: number;
  pickupStoreName: string;
}

export function pathaoAccountKey(
  integrationId: string | null | undefined,
  pathaoStoreId: number,
): string {
  return `${integrationId ?? "default"}:${pathaoStoreId}`;
}

/**
 * Build the selectable Pathao Accounts: each active pickup store joined to the
 * integration that owns it. Stores without an integration fall back to the
 * environment credentials and keep a stable "Pathao account" label.
 */
export function buildPathaoAccountOptions(
  integrations: readonly PathaoIntegrationRow[],
  stores: readonly PathaoStoreRow[],
): PathaoAccountOption[] {
  const integrationById = new Map<string, PathaoIntegrationRow>();
  for (const integration of integrations) {
    if (!integration.id || integration.is_active === false) continue;
    integrationById.set(integration.id, integration);
  }

  const options: PathaoAccountOption[] = [];
  for (const store of stores) {
    if (store.is_active === false) continue;
    const integration = store.integration_id
      ? integrationById.get(store.integration_id)
      : undefined;
    // A store scoped to a known-but-inactive integration is not selectable.
    if (store.integration_id && !integration) continue;
    options.push({
      key: pathaoAccountKey(store.integration_id, store.pathao_store_id),
      integrationId: store.integration_id,
      accountName: integration?.name?.trim() || "Pathao account",
      pathaoStoreId: store.pathao_store_id,
      pickupStoreName: store.store_name,
    });
  }

  return options.sort(
    (a, b) =>
      a.accountName.localeCompare(b.accountName) ||
      a.pickupStoreName.localeCompare(b.pickupStoreName) ||
      a.key.localeCompare(b.key),
  );
}

export function findPathaoAccount(
  options: readonly PathaoAccountOption[],
  integrationId: string | null | undefined,
  pathaoStoreId: number | null | undefined,
): PathaoAccountOption | undefined {
  if (pathaoStoreId == null) return undefined;
  const key = pathaoAccountKey(integrationId, pathaoStoreId);
  return options.find((option) => option.key === key);
}

/**
 * Resolve the `pathao_store_links` row for the first binding that has one.
 * Bindings are tried in priority order (Selling Point binding, then the Brand
 * binding, then the legacy store id); null/empty entries are skipped.
 */
export function resolveDefaultPathaoLink(
  links: readonly PathaoStoreLinkRow[],
  wooStoreIds: ReadonlyArray<string | null | undefined>,
): PathaoStoreLinkRow | undefined {
  for (const wooStoreId of wooStoreIds) {
    if (!wooStoreId) continue;
    const link = links.find((row) => row.woo_store_id === wooStoreId);
    if (link) return link;
  }
  return undefined;
}

/**
 * Resolve the default Pathao Account for a set of Woo store bindings
 * (brand -> woo_store_id -> pathao_store_links).
 */
export function resolveDefaultAccount(
  options: readonly PathaoAccountOption[],
  links: readonly PathaoStoreLinkRow[],
  wooStoreIds: ReadonlyArray<string | null | undefined>,
): PathaoAccountOption | undefined {
  const link = resolveDefaultPathaoLink(links, wooStoreIds);
  if (!link?.default_pathao_store_id) return undefined;
  return findPathaoAccount(options, link.pathao_integration_id, link.default_pathao_store_id);
}

/**
 * A selection only counts as an override when a default exists and the chosen
 * account differs from it. Picking an account where no default is configured
 * is a plain choice, not an override.
 */
export function isAccountOverride(
  selectedKey: string | null | undefined,
  defaultKey: string | null | undefined,
): boolean {
  return Boolean(selectedKey && defaultKey && selectedKey !== defaultKey);
}

/** Identity of one order in a dispatch batch. */
export interface DispatchOrderIdentity {
  id: string;
  brandId: string | null;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandWooStoreId: string | null;
  sellingPointName: string | null;
  sellingPointWooStoreId: string | null;
  /** Legacy `orders.store_id` binding (pre-Brand rows). */
  legacyStoreId: string | null;
}

export interface DispatchBrandGroup {
  /** Stable key: `${brandId ?? ""}|${defaultAccountKey ?? ""}`. */
  key: string;
  brandId: string | null;
  brandName: string;
  brandLogoUrl: string | null;
  orderIds: string[];
  /** Distinct Selling Point names in first-seen order (display chips). */
  sellingPointNames: string[];
  defaultAccountKey: string | null;
  defaultAccount: PathaoAccountOption | null;
}

export function orderDefaultAccountKey(
  order: DispatchOrderIdentity,
  links: readonly PathaoStoreLinkRow[],
  accounts: readonly PathaoAccountOption[],
): string | null {
  const account = resolveDefaultAccount(accounts, links, [
    order.sellingPointWooStoreId,
    order.brandWooStoreId,
    order.legacyStoreId,
  ]);
  return account?.key ?? null;
}

/**
 * Auto-group a dispatch batch per brand/account: orders of one Brand whose
 * default Pathao Accounts differ land in separate groups, and each group is
 * dispatched through its own account with its own selector.
 */
export function groupOrdersForDispatch(
  orders: readonly DispatchOrderIdentity[],
  links: readonly PathaoStoreLinkRow[],
  accounts: readonly PathaoAccountOption[],
): DispatchBrandGroup[] {
  const groups = new Map<string, DispatchBrandGroup>();

  for (const order of orders) {
    const defaultAccountKey = orderDefaultAccountKey(order, links, accounts);
    const brandKey = order.brandId ?? "";
    const key = `${brandKey}|${defaultAccountKey ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      const defaultAccount = defaultAccountKey
        ? accounts.find((option) => option.key === defaultAccountKey) ?? null
        : null;
      group = {
        key,
        brandId: order.brandId,
        brandName: order.brandName?.trim() || "No Brand",
        brandLogoUrl: order.brandLogoUrl,
        orderIds: [],
        sellingPointNames: [],
        defaultAccountKey,
        defaultAccount,
      };
      groups.set(key, group);
    }
    group.orderIds.push(order.id);
    const sellingPointName = order.sellingPointName?.trim();
    if (sellingPointName && !group.sellingPointNames.includes(sellingPointName)) {
      group.sellingPointNames.push(sellingPointName);
    }
  }

  return Array.from(groups.values());
}
