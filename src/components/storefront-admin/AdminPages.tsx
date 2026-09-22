import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ExternalLink, Palette, LayoutTemplate, Square, Grid3X3, List, Truck, CreditCard, Building2, Plus } from "lucide-react";
import { THEME_PRESETS } from "@/components/storefront-admin/shared";
import EditorPage from "@/components/storefront-admin/EditorPage";
import type { Storefront } from "@/storefront/lib/brand";

/* ---------------- Overview dashboard (Phase C) ---------------- */

export function StorefrontOverview() {
  const { slug } = useParams();
  const [sf, setSf] = useState<Storefront | null>(null);
  const [orders, setOrders] = useState<{ total: number; rows: any[]; recent: any[] }>({ total: 0, rows: [], recent: [] });
  const [productCount, setProductCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sfRow } = await supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle();
      if (!alive) return;
      setSf((sfRow as unknown as Storefront) || null);
      if (sfRow) {
        const sfId = (sfRow as any).id;
        const [{ count: totalOrders }, { data: agg }, { count: pc }, { data: recent }] = await Promise.all([
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("storefront_id", sfId),
          supabase.from("orders").select("total, status, created_at").eq("storefront_id", sfId).order("created_at", { ascending: false }).limit(500),
          supabase.from("storefront_products").select("id", { count: "exact", head: true }).eq("storefront_id", sfId),
          supabase.from("orders").select("id, order_number, status, total, created_at, customer_name").eq("storefront_id", sfId).order("created_at", { ascending: false }).limit(8),
        ]);
        if (!alive) return;
        const rows = (agg as any[]) || [];
        setOrders({ total: totalOrders ?? 0, rows, recent: (recent as any[]) || [] });
        setProductCount(pc ?? 0);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!sf) return <div className="text-center py-20 text-muted-foreground">Storefront not found.</div>;

  const today = new Date().toDateString();
  const allRows = orders.rows;
  const recentRows = orders.recent;
  const todayOrders = allRows.filter((o) => new Date(o.created_at).toDateString() === today);
  const revenueToday = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const revenueTotal = allRows.reduce((s, o) => s + Number(o.total || 0), 0);

  const statusCount = (st: string) => allRows.filter((o) => o.status === st).length;

  const quickActions = [
    { label: "Edit theme", to: `/storefronts/${slug}/admin/theme`, icon: <Palette className="h-4 w-4" /> },
    { label: "Edit homepage", to: `/storefronts/${slug}/admin/builder`, icon: <LayoutTemplate className="h-4 w-4" /> },
    { label: "Product card", to: `/storefronts/${slug}/admin/product-card`, icon: <Grid3X3 className="h-4 w-4" /> },
    { label: "Shop page", to: `/storefronts/${slug}/admin/shop-page`, icon: <List className="h-4 w-4" /> },
    { label: "Delivery", to: `/storefronts/${slug}/admin/delivery`, icon: <Truck className="h-4 w-4" /> },
    { label: "Payments", to: `/storefronts/${slug}/admin/payments`, icon: <CreditCard className="h-4 w-4" /> },
    { label: "Identity", to: `/storefronts/${slug}/admin/identity`, icon: <Building2 className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Revenue" value={`৳${revenueTotal.toLocaleString()}`} sub={`Today: ৳${revenueToday.toLocaleString()}`} />
        <KpiCard label="Total Orders" value={String(orders.total)} sub={`Today: ${todayOrders.length}`} />
        <KpiCard label="Products live" value={String(productCount ?? "—")} />
        <KpiCard label="Pageviews" value="—" sub="Traffic analytics: on the roadmap" muted />
      </div>

      {/* Order status */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium mb-4">Order status</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div><p className="text-2xl font-semibold">{statusCount("delivered")}</p><p className="text-xs text-muted-foreground">Delivered</p></div>
            <div><p className="text-2xl font-semibold">{statusCount("pending")}</p><p className="text-xs text-muted-foreground">Pending</p></div>
            <div><p className="text-2xl font-semibold">{statusCount("shipped")}</p><p className="text-xs text-muted-foreground">Shipped</p></div>
            <div><p className="text-2xl font-semibold">{statusCount("cancelled")}</p><p className="text-xs text-muted-foreground">Cancelled</p></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent orders */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium mb-4">Recent orders</h3>
            {recentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet. Share your store link to start getting orders.</p>
            ) : (
              <div className="divide-y divide-border">
                {recentRows.map((o) => (
                  <div key={o.id} className="flex items-center justify-between py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{o.order_number}</p>
                      <p className="text-xs text-muted-foreground truncate">{o.customer_name} · {new Date(o.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p>৳{Number(o.total || 0).toLocaleString()}</p>
                      <Badge variant="outline" className="text-[10px]">{o.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium mb-4">Quick actions</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {quickActions.map((a) => (
                <Link key={a.to} to={a.to} className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center hover:border-primary/50 transition">
                  {a.icon}
                  <span className="text-xs font-medium">{a.label}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, muted }: { label: string; value: string; sub?: string; muted?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${muted ? "text-muted-foreground" : ""}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ---------------- Theme gallery (Phase B) ---------------- */

export function ThemeGallery() {
  const { slug } = useParams();
  const [sf, setSf] = useState<Storefront | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data }) => setSf((data as unknown as Storefront) || null));
  }, [slug]);

  async function useTheme(themeKey: string, accentHex: string) {
    if (!sf) return;
    setSaving(themeKey);
    const { data, error } = await supabase
      .from("storefronts")
      .update({ theme: themeKey, accent_hex: accentHex })
      .eq("id", sf.id)
      .select()
      .single();
    setSaving(null);
    if (error) return;
    setSf(data as unknown as Storefront);
  }

  if (!sf) return <div className="text-center py-20 text-muted-foreground">Storefront not found.</div>;

  // Swatch strip per preset — fast, honest, no screenshot infra
  const swatches: Record<string, string[]> = {
    editorial: ["#814037", "#F5EFE6", "#2D2A26", "#C9B8A8"],
    cinematic: ["#FFFFFF", "#0A0A0A", "#1A1A1A", "#666666"],
    minimal: ["#000000", "#FFFFFF", "#FAFAFA", "#E5E5E5"],
    warm: ["#B56149", "#FBF3EA", "#3A2E28", "#E8C9A8"],
    nimbus: ["#2563EB", "#F0F6FF", "#0F172A", "#93B4F5"],
    saffron: ["#C2410C", "#FFF7ED", "#431407", "#FDBA74"],
  };
  const labels: Record<string, string> = {
    editorial: "Editorial — warm, elegant magazine style",
    cinematic: "Cinematic — bold, dark immersive layout",
    minimal: "Minimal — clean, modern, black & white",
    warm: "Warm — earthy, warm-toned and inviting",
    nimbus: "Nimbus — crisp blues for tech & gadgets",
    saffron: "Saffron — warm, appetizing food & beverage tones",
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Pick a ready-made theme. Preview opens the live storefront with that theme applied.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {THEME_PRESETS.map((t) => {
          const active = sf.theme === t.value;
          const sw = swatches[t.value] || swatches.editorial;
          return (
            <Card key={t.value} className={active ? "ring-2 ring-primary" : ""}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex gap-1">
                  {sw.map((c) => <span key={c} className="h-6 flex-1 rounded" style={{ background: c }} />)}
                </div>
                <div>
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{labels[t.value] || t.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a href={`/storefronts/preview/${slug}/home?surface=home&theme_override=${t.value}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">Preview</Button>
                  </a>
                  <Button size="sm" disabled={active || saving === t.value} onClick={() => useTheme(t.value, sw[0])}>
                    {saving === t.value ? "Applying…" : active ? "Active" : "Use this theme"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">More themes coming soon.</p>
    </div>
  );
}

/* ---------------- Help (Phase A) ---------------- */

export function AdminHelp() {
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h3 className="text-sm font-medium">Support</h3>
        <p className="text-sm text-muted-foreground">Questions about your storefront? Reach the team directly:</p>
        <a href="mailto:support@shohoz.biz">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="h-3.5 w-3.5" /> support@shohoz.biz
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}
