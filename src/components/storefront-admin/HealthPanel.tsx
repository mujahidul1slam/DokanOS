import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Activity, Image as ImageIcon, ShieldCheck, Timer } from "lucide-react";
import { mergeSettings } from "@/storefront/lib/settings";
import type { Storefront } from "@/storefront/lib/brand";

/**
 * Storefront health diagnostics (overhaul 6.1): live checks against the real
 * storefront — page timings (TTFB), image asset availability + payload,
 * checkout configuration flags, and missing-asset/404 detection.
 */

interface PageCheck {
  path: string;
  status: number | null;
  ttfbMs: number | null;
  error?: string;
}

interface AssetCheck {
  url: string;
  status: number | null;
  sizeKb: number | null;
  error?: string;
}

export default function HealthPanel() {
  const { slug } = useParams();
  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);
  const [pages, setPages] = useState<PageCheck[]>([]);
  const [assets, setAssets] = useState<AssetCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => { if (alive) setSf((data as unknown as Storefront) || null); });
    return () => { alive = false; };
  }, [slug]);

  async function runChecks() {
    if (!sf) return;
    setRunning(true);
    const origin = window.location.origin;
    const base = `${origin}/storefront/${sf.slug}`;

    // 1. Page checks: fetch the key routes, measure TTFB via Response headers/timing
    const pagePaths = ["/", "/shop", "/track", "/about"];
    const pageResults: PageCheck[] = [];
    for (const p of pagePaths) {
      const t0 = performance.now();
      try {
        const res = await fetch(base + p, { method: "GET" });
        pageResults.push({ path: p, status: res.status, ttfbMs: Math.round(performance.now() - t0) });
      } catch (e) {
        pageResults.push({ path: p, status: null, ttfbMs: null, error: e instanceof Error ? e.message : "fetch failed" });
      }
    }
    setPages(pageResults);

    // 2. Product image asset checks: sample up to 12 product images, HEAD each
    const { data: prods } = await supabase
      .from("storefront_products")
      .select("product_id")
      .eq("storefront_id", sf.id)
      .limit(12);
    let assetResults: AssetCheck[] = [];
    if (prods?.length) {
      const ids = prods.map((r: any) => r.product_id);
      const { data: prodRows } = await supabase
        .from("products")
        .select("id, image_url, image_urls")
        .in("id", ids);
      const urls = new Set<string>();
      for (const pr of (prodRows || []) as any[]) {
        if (pr.image_url) urls.add(pr.image_url);
        for (const u of pr.image_urls || []) urls.add(u);
      }
      assetResults = await Promise.all([...urls].slice(0, 12).map(async (u) => {
        try {
          const res = await fetch(u, { method: "HEAD" });
          const len = res.headers.get("content-length");
          return { url: u, status: res.status, sizeKb: len ? Math.round(Number(len) / 1024) : null };
        } catch (e) {
          return { url: u, status: null, sizeKb: null, error: e instanceof Error ? e.message : "failed" };
        }
      }));
    }
    setAssets(assetResults);
    setRunning(false);
    setRanAt(new Date().toLocaleTimeString());
  }

  if (sf === undefined) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!sf) return <div className="text-center py-20 text-muted-foreground">Storefront not found.</div>;

  const settings = mergeSettings(sf.settings);
  const methods = settings.checkout.methods;
  const anyMethod = Object.values(methods).some(Boolean);
  const badPages = pages.filter((p) => p.status === null || p.status >= 400);
  const badAssets = assets.filter((a) => a.status === null || a.status >= 400);
  const totalImageKb = assets.reduce((s, a) => s + (a.sizeKb || 0), 0);
  const avgTtfb = pages.length ? Math.round(pages.reduce((s, p) => s + (p.ttfbMs || 0), 0) / pages.length) : null;

  const healthFlags = [
    { ok: anyMethod, label: anyMethod ? "Checkout methods configured" : "No payment methods enabled — checkout will reject orders" },
    { ok: settings.checkout.min_order_amount >= 0, label: "Minimum order amount valid" },
    { ok: settings.shipping.free_threshold >= 0, label: "Free shipping threshold valid" },
    { ok: badAssets.length === 0, label: badAssets.length === 0 ? "All sampled images resolve" : `${badAssets.length} sampled image(s) fail to load (404/missing)` },
    { ok: badPages.length === 0, label: badPages.length === 0 ? "All storefront routes respond" : `${badPages.length} route(s) failing` },
    { ok: !!sf.hero_image_url || !!sf.logo_url, label: "Hero or logo image set" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Storefront health</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Live checks against {`/storefront/${sf.slug}`} {ranAt && `· last run ${ranAt}`}</p>
        </div>
        <Button onClick={runChecks} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {running ? "Running…" : "Run checks"}
        </Button>
      </div>

      {/* Health flags */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <h4 className="text-sm font-medium mb-1 inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Configuration & assets</h4>
          {healthFlags.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Badge variant={f.ok ? "default" : "destructive"} className="text-[10px]">{f.ok ? "OK" : "FAIL"}</Badge>
              {f.label}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Page timings */}
      {pages.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h4 className="text-sm font-medium mb-3 inline-flex items-center gap-2"><Timer className="h-4 w-4" /> Page load (TTFB){avgTtfb != null && ` · avg ${avgTtfb}ms`}</h4>
            <div className="divide-y divide-border">
              {pages.map((p) => (
                <div key={p.path} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-xs">{p.path}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={p.status && p.status < 400 ? "default" : "destructive"} className="text-[10px]">{p.status ?? "ERR"}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{p.ttfbMs != null ? `${p.ttfbMs}ms` : p.error}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Core Web Vitals (LCP/CLS/INP) land with the analytics pipeline.</p>
          </CardContent>
        </Card>
      )}

      {/* Image payload */}
      {assets.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h4 className="text-sm font-medium mb-3 inline-flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Image assets · {totalImageKb}KB sampled</h4>
            <div className="divide-y divide-border max-h-64 overflow-auto">
              {assets.map((a) => (
                <div key={a.url} className="flex items-center justify-between py-2 text-sm gap-3">
                  <span className="font-mono text-[11px] truncate min-w-0">{a.url}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant={a.status && a.status < 400 ? "default" : "destructive"} className="text-[10px]">{a.status ?? "ERR"}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{a.sizeKb != null ? `${a.sizeKb}KB` : a.error}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!ranAt && (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            <Activity className="h-6 w-6 mx-auto mb-2 text-muted-foreground/40" />
            Run checks to see live storefront health.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
