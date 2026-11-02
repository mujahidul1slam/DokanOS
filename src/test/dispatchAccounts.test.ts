import { describe, expect, it } from "vitest";
import {
  buildPathaoAccountOptions,
  defaultPathaoStoreForAccount,
  findPathaoAccount,
  groupOrdersForDispatch,
  isAccountOverride,
  orderDefaultAccountKey,
  pathaoAccountKey,
  resolveDefaultAccount,
  resolveDefaultPathaoLink,
  type DispatchOrderIdentity,
  type PathaoAccountOption,
  type PathaoStoreLinkRow,
} from "@/lib/dispatchAccounts";

const integrations = [
  { id: "int-1", name: "Pathao Main", is_active: true },
  { id: "int-2", name: "Pathao Outlet", is_active: true },
  { id: "int-off", name: "Disabled", is_active: false },
];

const stores = [
  { pathao_store_id: 11, store_name: "Mirpur Hub", integration_id: "int-1", is_active: true },
  { pathao_store_id: 22, store_name: "Uttara Hub", integration_id: "int-1", is_active: true },
  { pathao_store_id: 33, store_name: "Chattogram Hub", integration_id: "int-2", is_active: true },
  { pathao_store_id: 44, store_name: "Dead Hub", integration_id: "int-1", is_active: false },
  { pathao_store_id: 55, store_name: "Orphan Hub", integration_id: "int-off", is_active: true },
  { pathao_store_id: 66, store_name: "Legacy Hub", integration_id: null, is_active: true },
];

const accounts = buildPathaoAccountOptions(integrations, stores);

const links: PathaoStoreLinkRow[] = [
  { woo_store_id: "store-a", pathao_integration_id: "int-1", default_pathao_store_id: 11 },
  { woo_store_id: "store-b", pathao_integration_id: "int-2", default_pathao_store_id: 33 },
  { woo_store_id: "store-c", pathao_integration_id: "int-1", default_pathao_store_id: null },
];

const order = (id: string, over: Partial<DispatchOrderIdentity> = {}): DispatchOrderIdentity => ({
  id,
  brandId: "brand-a",
  brandName: "Acme Fashion",
  brandLogoUrl: null,
  brandWooStoreId: "store-a",
  sellingPointName: "Showroom",
  sellingPointWooStoreId: null,
  legacyStoreId: null,
  ...over,
});

describe("dispatchAccounts", () => {
  describe("buildPathaoAccountOptions", () => {
    it("pairs each active pickup store with its integration label", () => {
      expect(accounts.map((a) => a.key)).toEqual([
        "default:66",
        "int-1:11",
        "int-1:22",
        "int-2:33",
      ]);
      expect(accounts.find((a) => a.key === "int-1:11")).toMatchObject({
        integrationId: "int-1",
        accountName: "Pathao Main",
        pickupStoreName: "Mirpur Hub",
      });
    });

    it("drops inactive stores and stores under inactive integrations", () => {
      expect(accounts.some((a) => a.pathaoStoreId === 44)).toBe(false);
      expect(accounts.some((a) => a.pathaoStoreId === 55)).toBe(false);
    });

    it("labels integration-less stores as the default Pathao account", () => {
      const legacy = accounts.find((a) => a.pathaoStoreId === 66)!;
      expect(legacy.integrationId).toBeNull();
      expect(legacy.accountName).toBe("Pathao account");
      expect(legacy.key).toBe(pathaoAccountKey(null, 66));
    });
  });

  describe("defaultPathaoStoreForAccount (brand settings auto-select)", () => {
    it("picks the account's first store in display order (name, then id)", () => {
      expect(defaultPathaoStoreForAccount([])).toBeUndefined();

      const only = [{ pathao_store_id: 5, store_name: "Banani Hub" }];
      expect(defaultPathaoStoreForAccount(only)?.pathao_store_id).toBe(5);

      // Display order wins over input order.
      expect(
        defaultPathaoStoreForAccount([
          { pathao_store_id: 22, store_name: "Uttara Hub" },
          { pathao_store_id: 11, store_name: "Mirpur Hub" },
        ])?.pathao_store_id,
      ).toBe(11);

      // Same name: tie-broken by pathao_store_id.
      expect(
        defaultPathaoStoreForAccount([
          { pathao_store_id: 2, store_name: "Same Name" },
          { pathao_store_id: 1, store_name: "Same Name" },
        ])?.pathao_store_id,
      ).toBe(1);
    });

    it("does not mutate its input", () => {
      const stores = [
        { pathao_store_id: 22, store_name: "Uttara Hub" },
        { pathao_store_id: 11, store_name: "Mirpur Hub" },
      ];
      defaultPathaoStoreForAccount(stores);
      expect(stores.map((s) => s.pathao_store_id)).toEqual([22, 11]);
    });
  });

  describe("default resolution (brand -> woo_store_id -> pathao_store_links)", () => {
    it("resolves the link by the first binding that has one", () => {
      expect(resolveDefaultPathaoLink(links, [null, "store-b", "store-a"])?.woo_store_id).toBe("store-b");
      expect(resolveDefaultPathaoLink(links, ["missing", "store-a"])?.woo_store_id).toBe("store-a");
      expect(resolveDefaultPathaoLink(links, [null, undefined])).toBeUndefined();
    });

    it("resolves the default account from the link", () => {
      const resolved = resolveDefaultAccount(accounts, links, ["store-a"]);
      expect(resolved).toMatchObject({ key: "int-1:11", pickupStoreName: "Mirpur Hub" });
    });

    it("resolves nothing when the link has no default store", () => {
      expect(resolveDefaultAccount(accounts, links, ["store-c"])).toBeUndefined();
      expect(resolveDefaultAccount(accounts, links, ["missing"])).toBeUndefined();
    });

    it("finds accounts across integrations by key", () => {
      expect(findPathaoAccount(accounts, "int-2", 33)?.accountName).toBe("Pathao Outlet");
      expect(findPathaoAccount(accounts, "int-1", 33)).toBeUndefined();
    });
  });

  describe("isAccountOverride", () => {
    it("flags only a non-default choice when a default exists", () => {
      expect(isAccountOverride("int-1:22", "int-1:11")).toBe(true);
      expect(isAccountOverride("int-1:11", "int-1:11")).toBe(false);
      expect(isAccountOverride("int-1:11", null)).toBe(false);
      expect(isAccountOverride(null, "int-1:11")).toBe(false);
    });
  });

  describe("groupOrdersForDispatch", () => {
    it("groups orders of one brand/account into one group", () => {
      const groups = groupOrdersForDispatch(
        [order("o1"), order("o2", { sellingPointName: "Facebook" })],
        links,
        accounts,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        key: "brand-a|int-1:11",
        brandName: "Acme Fashion",
        orderIds: ["o1", "o2"],
        sellingPointNames: ["Showroom", "Facebook"],
        defaultAccountKey: "int-1:11",
      });
    });

    it("splits one brand when its orders resolve to different default accounts", () => {
      const groups = groupOrdersForDispatch(
        [
          order("o1"),
          order("o2", { sellingPointWooStoreId: "store-b", sellingPointName: "Outlet" }),
        ],
        links,
        accounts,
      );
      expect(groups.map((g) => g.key)).toEqual(["brand-a|int-1:11", "brand-a|int-2:33"]);
      expect(groups[1].orderIds).toEqual(["o2"]);
    });

    it("keeps different brands in separate groups even with the same default", () => {
      const groups = groupOrdersForDispatch(
        [
          order("o1"),
          order("o2", { brandId: "brand-b", brandName: "Bluebird", brandWooStoreId: "store-a" }),
        ],
        links,
        accounts,
      );
      expect(groups.map((g) => g.brandName)).toEqual(["Acme Fashion", "Bluebird"]);
    });

    it("falls back to the legacy store binding and groups unbranded orders", () => {
      const groups = groupOrdersForDispatch(
        [
          order("o1", { brandWooStoreId: null, legacyStoreId: "store-a" }),
          order("o2", { brandId: null, brandName: null, brandWooStoreId: null, legacyStoreId: null }),
        ],
        links,
        accounts,
      );
      expect(groups[0]).toMatchObject({ key: "brand-a|int-1:11", defaultAccountKey: "int-1:11" });
      expect(groups[1]).toMatchObject({ key: "|", brandName: "No Brand", defaultAccountKey: null });
    });

    it("computes per-order default keys with binding priority", () => {
      expect(
        orderDefaultAccountKey(
          order("o1", { sellingPointWooStoreId: "store-b", brandWooStoreId: "store-a" }),
          links,
          accounts,
        ),
      ).toBe("int-2:33");
    });
  });
});
