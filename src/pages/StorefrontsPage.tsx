import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { invalidateSlugCache } from "@/storefront/lib/brand";
import type { Storefront } from "@/storefront/lib/brand";
import BrandProfileTab from "@/components/storefront-admin/BrandProfileTab";
import SocialPoliciesTab from "@/components/storefront-admin/SocialPoliciesTab";
import DomainsTab from "@/components/storefront-admin/DomainsTab";
import ProductsTab from "@/components/storefront-admin/ProductsTab";
import PagesTab from "@/components/storefront-admin/PagesTab";
import CollectionsTab from "@/components/storefront-admin/CollectionsTab";
import SettingsTab from "@/components/storefront-admin/SettingsTab";
import CardStyleTab from "@/components/storefront-admin/CardStyleTab";
import ProductPageTab from "@/components/storefront-admin/ProductPageTab";
import ShopPageTab from "@/components/storefront-admin/ShopPageTab";
import HeaderFooterTab from "@/components/storefront-admin/HeaderFooterTab";
import AnimationsTab from "@/components/storefront-admin/AnimationsTab";
import DeliveryTab from "@/components/storefront-admin/DeliveryTab";
import PaymentsTab from "@/components/storefront-admin/PaymentsTab";
import { THEME_PRESETS } from "@/components/storefront-admin/shared";

/** Storefronts admin shell — the former 818-line page, split into tabs (Phase 1 refactor). */
export default function StorefrontsPage() {
  const [list, setList] = useState<Storefront[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  async function reload() {
    const { data } = await supabase.from("storefronts").select("*").order("name");
    setList((data as any) || []);
    invalidateSlugCache();
    return data;
  }

  useEffect(() => {
    supabase.from("storefronts").select("*").order("name").then(({ data }) => {
      setList((data as any) || []);
      setActiveId((data?.[0] as any)?.id ?? null);
      setLoading(false);
    });
  }, []);

  const active = list.find((s) => s.id === activeId);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Storefronts</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {list.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.id === activeId ? "default" : "outline"}
              onClick={() => setActiveId(s.id)}
            >
              {s.name}
            </Button>
          ))}
          <CreateStorefrontDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreate={async (newSf) => {
              await reload();
              setActiveId(newSf.id);
            }}
          />
        </div>
      </div>

      {active && (
        <StorefrontEditor
          sf={active}
          onUpdate={(s) => {
            setList((l) => l.map((x) => (x.id === s.id ? s : x)));
            invalidateSlugCache();
          }}
        />
      )}
    </div>
  );
}

function StorefrontEditor({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{sf.name}</CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">/{sf.slug}</Badge>
            <Badge variant={sf.is_active ? "default" : "secondary"}>{sf.is_active ? "Live" : "Hidden"}</Badge>
          </div>
        </div>
        <a href={`/storefront/${sf.slug}`} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" className="gap-2"><ExternalLink className="h-4 w-4" /> View live</Button>
        </a>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pages">
          <TabsList>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="collections">Collections</TabsTrigger>
            <TabsTrigger value="profile">Brand profile</TabsTrigger>
            <TabsTrigger value="cardstyle">Card style</TabsTrigger>
            <TabsTrigger value="productpage">Product page</TabsTrigger>
            <TabsTrigger value="shoppage">Shop page</TabsTrigger>
            <TabsTrigger value="headerfooter">Header &amp; Footer</TabsTrigger>
            <TabsTrigger value="animations">Animations</TabsTrigger>
            <TabsTrigger value="delivery">Delivery</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="content">Social &amp; policies</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="domains">Domains</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
          </TabsList>
          <TabsContent value="pages" className="pt-4 space-y-6">
            <PagesTab sf={sf} />
          </TabsContent>
          <TabsContent value="collections" className="pt-4 space-y-6">
            <CollectionsTab sf={sf} />
          </TabsContent>
          <TabsContent value="profile" className="pt-4 space-y-4">
            <BrandProfileTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="cardstyle" className="pt-4 space-y-6">
            <CardStyleTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="productpage" className="pt-4 space-y-6">
            <ProductPageTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="shoppage" className="pt-4 space-y-6">
            <ShopPageTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="headerfooter" className="pt-4 space-y-6">
            <HeaderFooterTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="animations" className="pt-4 space-y-6">
            <AnimationsTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="delivery" className="pt-4 space-y-6">
            <DeliveryTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="payments" className="pt-4 space-y-6">
            <PaymentsTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="content" className="pt-4 space-y-6">
            <SocialPoliciesTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="settings" className="pt-4 space-y-6">
            <SettingsTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="domains" className="pt-4 space-y-6">
            <DomainsTab sf={sf} onUpdate={onUpdate} />
          </TabsContent>
          <TabsContent value="products" className="pt-4 space-y-6">
            <ProductsTab sf={sf} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CreateStorefrontDialog({ open, onOpenChange, onCreate }: { open: boolean, onOpenChange: (open: boolean) => void, onCreate: (sf: any) => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState("editorial");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setSlug("");
      setTheme("editorial");
    }
  }, [open]);

  function handleNameChange(val: string) {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !slug) return;
    setSaving(true);

    const defaultAccents: Record<string, string> = {
      editorial: "#814037",
      cinematic: "#ffffff",
      minimal: "#000000",
      warm: "#b56149",
    };

    const { data: storeData } = await supabase.from("stores").select("id").limit(1).maybeSingle();

    const { data, error } = await supabase.from("storefronts").insert({
      name,
      slug,
      theme,
      accent_hex: defaultAccents[theme] || "#000000",
      store_id: storeData?.id || null,
      currency: "BDT",
    }).select().single();

    setSaving(false);
    if (error) {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
    } else if (data) {
      toast({ title: "Storefront created successfully" });
      onCreate(data);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> New Storefront
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Create new storefront</DialogTitle>
            <DialogDescription>
              Launch a new native storefront brand. You can configure domains and content later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-6">
            <div className="grid gap-2">
              <Label htmlFor="name">Storefront Name</Label>
              <Input id="name" value={name} onChange={(e) => handleNameChange(e.target.value)} required placeholder="e.g. My Brand" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="slug">URL Slug</Label>
              <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required placeholder="e.g. my-brand" />
              <p className="text-xs text-muted-foreground">Will be accessible at shohoz.biz/storefront/{slug || "..."}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="theme">Initial Theme</Label>
              <Select value={theme} onValueChange={setTheme}>
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEME_PRESETS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div>{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name || !slug}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}