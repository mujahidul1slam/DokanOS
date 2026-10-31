import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileSpreadsheet, Loader2, PackagePlus, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  orderSourceConnectionState,
  orderSourceLabel,
  type OrderSourceRow,
} from "@/lib/orderSources";
import {
  importProductDrafts,
  parseProductsCsv,
  productCsvTemplate,
  type ProductCsvRow,
} from "@/lib/productImport";
import { downloadCsv } from "@/lib/exportCsv";
import { kickSyncWorker } from "@/lib/wooNotes";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnboardingStepProps } from "../stepProps";
import { StepFooter } from "./StepFooter";

/**
 * Wizard step 5 (spec §6a: "Product import — WooCommerce import (if that
 * source was connected), CSV import, or manual. (CSV is an action, not an
 * entity.)"). Three actions, one step: the Woo import kicks the sync worker
 * for a connected source, the CSV action imports a one-shot file as products
 * with provenance `csv`, and manual deep-links to the product form.
 */
export function ProductImportStep({ brands, onFinished, onBack }: OnboardingStepProps) {
  const navigate = useNavigate();
  const { brandStores } = useBusinessContext();

  const [wooSources, setWooSources] = useState<OrderSourceRow[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [kicking, setKicking] = useState(false);

  const [targetStoreId, setTargetStoreId] = useState<string>("");
  const [parsedRows, setParsedRows] = useState<ProductCsvRow[]>([]);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [importing, setImporting] = useState(false);

  const brandIds = useMemo(() => brands.map((b) => b.id), [brands]);

  useEffect(() => {
    if (brandIds.length === 0) return;
    let cancelled = false;
    setLoadingSources(true);
    (async () => {
      const { data } = await supabase
        .from("order_sources")
        .select("*")
        .in("brand_id", brandIds)
        .eq("type", "woocommerce")
        .order("name");
      if (cancelled) return;
      setWooSources((data ?? []) as OrderSourceRow[]);
      setLoadingSources(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [brandIds]);

  // Products attach to a store of the business (store-scoped catalog) — pick
  // the first one by default, like the Products page's filter.
  useEffect(() => {
    setTargetStoreId((current) =>
      brandStores.some((s) => s.id === current) ? current : (brandStores[0]?.id ?? ""),
    );
  }, [brandStores]);

  const connectedWoo = wooSources.filter(
    (s) => orderSourceConnectionState(s) === "connected",
  );
  const unconfiguredWoo = wooSources.filter(
    (s) => orderSourceConnectionState(s) === "needs_setup",
  );

  const runWooImport = async () => {
    if (kicking) return;
    setKicking(true);
    try {
      await kickSyncWorker();
      toast.success(
        `WooCommerce import started — ${connectedWoo.length === 1 ? `“${connectedWoo[0].name}”` : "your connected stores"} will sync products and orders shortly.`,
      );
    } catch {
      toast.error("Could not reach the sync worker. The import runs on its regular schedule instead.");
    } finally {
      setKicking(false);
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseProductsCsv(text);
    setParsedRows(parsed.rows);
    setParseErrors(parsed.errors);
    if (parsed.rows.length === 0 && parsed.errors.length > 0) {
      toast.error("No usable rows in this file — check the errors below.");
    }
  };

  const runCsvImport = async () => {
    if (importing || parsedRows.length === 0 || !targetStoreId) return;
    setImporting(true);
    const result = await importProductDrafts(parsedRows, targetStoreId);
    setImporting(false);
    if (result.failed.length === 0) {
      toast.success(`Imported ${result.imported} product${result.imported === 1 ? "" : "s"}.`);
      setParsedRows([]);
      setParseErrors([]);
      setFileName("");
    } else {
      toast.error(
        `Imported ${result.imported}, but ${result.failed.length} row${result.failed.length === 1 ? "" : "s"} failed.`,
      );
      setParseErrors(result.failed);
    }
  };

  const downloadTemplate = () => {
    const { headers, rows } = productCsvTemplate();
    downloadCsv("product-import-template.csv", headers, rows);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <RefreshCw className="h-4 w-4" /> WooCommerce import
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pull products (and orders) in from a connected WooCommerce store.
            </p>
          </div>
        </div>
        {loadingSources ? (
          <p className="text-xs text-muted-foreground">Checking your sources…</p>
        ) : connectedWoo.length > 0 ? (
          <div className="space-y-2">
            {connectedWoo.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {orderSourceLabel(s.type)} · connected
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void runWooImport()}
                  disabled={kicking}
                >
                  {kicking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Import products
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              {unconfiguredWoo.length > 0 ? (
                <>
                  {unconfiguredWoo.map((s) => s.name).join(", ")}: the connection isn’t finished yet.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2"
                    onClick={() => navigate("/order-sources")}
                  >
                    Add the URL + API keys on Order Sources
                  </button>
                  , then come back to import.
                </>
              ) : (
                <>
                  No WooCommerce source yet.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2"
                    onClick={() => navigate("/order-sources")}
                  >
                    Create one on Order Sources
                  </button>{" "}
                  to import from your store.
                </>
              )}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="h-4 w-4" /> CSV import
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A one-time import from a CSV file (columns: name, sku, price, category,
            stock_quantity, description, image_url, barcode).
          </p>
        </div>
        {brandStores.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              Products live under a brand’s store.{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
                onClick={() => navigate("/brands")}
              >
                Add a store on the Brands page
              </button>{" "}
              first, then import here.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <span className="text-sm font-medium leading-none">Import into</span>
              <Select value={targetStoreId} onValueChange={setTargetStoreId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a store" />
                </SelectTrigger>
                <SelectContent>
                  {brandStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="onboarding-csv-file"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void onFileChange(e)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => document.getElementById("onboarding-csv-file")?.click()}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {fileName ? "Choose another file" : "Choose CSV file"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>
                Download template
              </Button>
              {fileName && (
                <Badge variant="secondary" className="max-w-[220px] truncate">
                  {fileName}
                </Badge>
              )}
            </div>
            {(parsedRows.length > 0 || parseErrors.length > 0) && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <p className="text-foreground">
                  {parsedRows.length} row{parsedRows.length === 1 ? "" : "s"} ready to import.
                </p>
                {parseErrors.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-destructive">
                    {parseErrors.slice(0, 5).map((e) => (
                      <li key={`${e.line}-${e.message}`}>
                        Line {e.line}: {e.message}
                      </li>
                    ))}
                    {parseErrors.length > 5 && <li>…and {parseErrors.length - 5} more</li>}
                  </ul>
                )}
              </div>
            )}
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => void runCsvImport()}
              disabled={importing || parsedRows.length === 0 || !targetStoreId}
            >
              {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import {parsedRows.length > 0 ? parsedRows.length : ""} product
              {parsedRows.length === 1 ? "" : "s"}
            </Button>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <PackagePlus className="h-4 w-4" /> Manual
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add a product by hand — opens the product form on the Products page.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => navigate("/products?new=1")}
        >
          <Store className="h-4 w-4" /> Add a product manually
        </Button>
      </section>

      <StepFooter onBack={onBack} onSkip={() => void onFinished("skipped")} busy={importing}>
        <Button type="button" onClick={() => void onFinished("completed")}>
          Continue
        </Button>
      </StepFooter>
    </div>
  );
}
