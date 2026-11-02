import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSettings } from "@/hooks/useInvoiceSettings";
import {
  buildPrintDocument,
  sourceLabel,
  type SlipOrderData,
  type SlipPathaoAccount,
} from "@/lib/pickupSlipHtml";
import { brandAccent, deriveBrandForStore } from "@/lib/brandIdentity";
import {
  buildPathaoAccountOptions,
  pathaoAccountKey,
  resolveDefaultAccount,
  type PathaoIntegrationRow,
  type PathaoStoreLinkRow,
  type PathaoStoreRow,
} from "@/lib/dispatchAccounts";
import { supabase } from "@/integrations/supabase/client";
import { addOrderTimeline } from "@/lib/orderTimeline";
import { logAction } from "@/lib/auditLog";
import { openPrintWindow } from "@/lib/printWindow";

/**
 * Slip identity/dispatch details resolved from the database (issue #24):
 * brand + Selling Point, order source label, and the Pathao Account — the
 * actual account once dispatched, the brand/Selling Point default account
 * (marked "(default)") before dispatch, or null when none is configured.
 */
export type SlipOrderDetail = Pick<
  SlipOrderData,
  "brand" | "sellingPointName" | "sourceLabel" | "source" | "pathaoAccount" | "dispatched" | "consignmentId"
>;

/** Label fallback from dispatchAccounts: a store without an integration name. */
const GENERIC_ACCOUNT_NAME = "Pathao account";

interface ResolvedRows {
  integrations: PathaoIntegrationRow[];
  stores: PathaoStoreRow[];
  links: PathaoStoreLinkRow[];
}

/** Display name for an account recorded on an order (active or not). */
function describeAccount(
  rows: ResolvedRows,
  integrationId: string | null | undefined,
  pathaoStoreId: number | null | undefined,
): SlipPathaoAccount | null {
  if (pathaoStoreId == null) return null;
  const store =
    rows.stores.find(
      (s) =>
        s.pathao_store_id === pathaoStoreId &&
        (s.integration_id ?? null) === (integrationId ?? null),
    ) ?? rows.stores.find((s) => s.pathao_store_id === pathaoStoreId);
  const integration = integrationId
    ? rows.integrations.find((i) => i.id === integrationId)
    : undefined;
  return {
    name: integration?.name?.trim() || GENERIC_ACCOUNT_NAME,
    pickupStoreName: store?.store_name || null,
    isDefault: false,
  };
}

/**
 * Resolve the slip's identity and dispatch lines for the given orders.
 *
 * Glossary rules (issue #24): before dispatch the slip shows the brand/
 * Selling Point default Pathao Account with a "(default)" marker — or the
 * account explicitly selected on the order, marked "(default)" only when it
 * IS that default. Dispatched orders show the actual account without a
 * marker. Nothing configured resolves to null → "Pathao Account not selected".
 *
 * Best-effort: a failed lookup resolves to an empty map so printing degrades
 * to the caller's own data instead of breaking.
 */
export async function fetchSlipOrderDetails(ids: string[]): Promise<Map<string, SlipOrderDetail>> {
  const details = new Map<string, SlipOrderDetail>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return details;

  try {
    const { data: orderRows } = await supabase
      .from("orders")
      .select(
        "id, source, consignment_id, pathao_integration_id, pathao_store_id, store_id, selling_point_id, stores(name), selling_points(id, name, woo_store_id, brand_id, brands(id, name, logo_url, woo_store_id))",
      )
      .in("id", unique);

    const rows = (orderRows || []) as any[];
    const legacyStoreIds = Array.from(
      new Set(rows.map((r) => r.store_id).filter(Boolean)),
    ) as string[];

    const [integRes, storeRes, linkRes, legacyBrandRes] = await Promise.all([
      supabase.from("pathao_integrations_safe").select("id, name, is_active"),
      supabase.from("pathao_stores").select("pathao_store_id, store_name, integration_id, is_active"),
      supabase.from("pathao_store_links").select("woo_store_id, pathao_integration_id, default_pathao_store_id"),
      legacyStoreIds.length > 0
        ? supabase.from("brands").select("id, name, logo_url, woo_store_id").in("woo_store_id", legacyStoreIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const resolved: ResolvedRows = {
      integrations: ((integRes as any).data || []) as PathaoIntegrationRow[],
      stores: ((storeRes as any).data || []) as PathaoStoreRow[],
      links: ((linkRes as any).data || []) as PathaoStoreLinkRow[],
    };
    const legacyBrands = ((legacyBrandRes as any).data || []) as any[];

    // Defaults must be currently selectable accounts (active rows only).
    const accountOptions = buildPathaoAccountOptions(resolved.integrations, resolved.stores);

    for (const row of rows) {
      const sellingPoint = row.selling_points || null;
      const canonicalBrand = sellingPoint?.brands || null;
      const legacyBrand = canonicalBrand
        ? null
        : deriveBrandForStore(legacyBrands, row.store_id) || null;
      const brandRow = canonicalBrand || legacyBrand;
      const brand = brandRow
        ? {
            id: brandRow.id,
            name: brandRow.name,
            logo_url: brandRow.logo_url ?? null,
            accent: brandAccent(brandRow.id),
          }
        : null;

      const dispatched = Boolean(row.consignment_id);
      const selected = describeAccount(resolved, row.pathao_integration_id, row.pathao_store_id);
      const defaultAccount = resolveDefaultAccount(accountOptions, resolved.links, [
        sellingPoint?.woo_store_id,
        brandRow?.woo_store_id,
        row.store_id,
      ]);

      let pathaoAccount: SlipPathaoAccount | null = null;
      if (dispatched) {
        pathaoAccount = selected;
      } else if (selected) {
        pathaoAccount = {
          ...selected,
          isDefault:
            Boolean(defaultAccount) &&
            pathaoAccountKey(row.pathao_integration_id, row.pathao_store_id) === defaultAccount!.key,
        };
      } else if (defaultAccount) {
        pathaoAccount = {
          name: defaultAccount.accountName,
          pickupStoreName: defaultAccount.pickupStoreName,
          isDefault: true,
        };
      }

      details.set(row.id, {
        brand,
        sellingPointName: sellingPoint?.name || row.stores?.name || null,
        sourceLabel: sourceLabel(row.source),
        source: row.source ?? null,
        pathaoAccount,
        dispatched,
        consignmentId: row.consignment_id ?? null,
      });
    }
  } catch (e) {
    console.warn("fetchSlipOrderDetails failed:", e);
  }

  return details;
}

interface Props {
  orders: SlipOrderData[];
  onPrinted?: (orderIds: string[]) => void;
}

export default function PickupSlipPrint({ orders, onPrinted }: Props) {
  const { settings } = useInvoiceSettings();
  const tpl = settings.pickup_slip_template;
  const format = (settings.pickup_slip_print_format || "thermal") as "thermal" | "a4";

  // Identity/dispatch details resolve eagerly — never at click time — so the
  // print window still opens inside the user gesture. window.open() after an
  // await is popup-blocked in Chrome.
  const idsKey = useMemo(
    () => orders.map((o) => o.id).filter(Boolean).join(","),
    [orders],
  );
  const [details, setDetails] = useState<Map<string, SlipOrderDetail>>(new Map());

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    fetchSlipOrderDetails(ids).then((map) => {
      if (!cancelled) setDetails(map);
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  // Caller-supplied fields win; the lookup only fills what is missing.
  const resolvedOrders: SlipOrderData[] = useMemo(
    () => orders.map((o) => (o.id && details.has(o.id) ? { ...details.get(o.id), ...o } : o)),
    [orders, details],
  );

  const handlePrint = async () => {
    // Auto-print is triggered by the document's own bootstrap script (see
    // PRINT_BOOTSTRAP in lib/printWindow). Calling print() again from here
    // causes Chrome to re-spool the whole job, which on non-thermal drivers
    // can produce multi-GB PDFs. Do not add a second print() call.
    if (!openPrintWindow(buildPrintDocument(resolvedOrders, tpl, format))) return;
    // Stamp printed-at on each order and log timeline + audit entries.
    const printedOrders = resolvedOrders.filter((o: any) => o.id);
    const ids = printedOrders.map((o: any) => o.id);
    if (ids.length > 0) {
      try {
        await supabase
          .from("orders")
          .update({ pickup_slip_printed_at: new Date().toISOString() } as any)
          .in("id", ids);
        onPrinted?.(ids);

        // Order timeline entry per order (also mirrors to Woo notes).
        await addOrderTimeline(
          printedOrders.map((o: any) => ({
            order_id: o.id,
            event: "pickup_slip_printed",
            description: `Pickup slip printed (${format.toUpperCase()})`,
            metadata: { format, batch_size: ids.length },
          })),
        );

        // Audit log: single entry summarising the batch.
        await logAction("print", "pickup_slip", ids.length === 1 ? ids[0] : undefined, {
          order_ids: ids,
          order_numbers: printedOrders.map((o: any) => o.order_number).filter(Boolean),
          count: ids.length,
          format,
        });
      } catch (e) {
        console.warn("Failed to stamp/log pickup slip print:", e);
      }
    }
  };

  if (orders.length === 0) return null;

  return (
    <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
      <Printer className="h-4 w-4" /> Print Pickup Slip{orders.length > 1 ? "s" : ""}
    </Button>
  );
}
