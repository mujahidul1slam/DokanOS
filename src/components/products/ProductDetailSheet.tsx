import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, RefreshCw, X, Sparkles, ExternalLink } from "lucide-react";
import { logAction } from "@/lib/auditLog";
import { usePermissions } from "@/hooks/usePermissions";
import SizePresetsEditor from "@/components/measurements/SizePresetsEditor";
import { getGroupsForProduct, type MeasurementGroup } from "@/lib/measurements";

/* ---------- types ---------- */
interface Variation {
  id?: string;
  woo_variation_id?: number | null;
  name: string;
  sku: string;
  price: number;
  manage_stock: boolean;
  stock_quantity: number;
  stock_status: string;
  barcode: string;
  attributes: { key: string; value: string }[];
}

interface ProductForm {
  id?: string;
  name: string;
  sku: string;
  price: number;
  cost_price: number;
  description: string;
  category: string;
  image_url: string;
  barcode: string;
  manage_stock: boolean;
  stock_quantity: number;
  stock_status: string;
  is_active: boolean;
}

const emptyForm: ProductForm = {
  name: "", sku: "", price: 0, cost_price: 0, description: "", category: "",
  image_url: "", barcode: "", manage_stock: true, stock_quantity: 0,
  stock_status: "in_stock", is_active: true,
};

const STOCK_STATUSES = [
  { value: "in_stock", label: "In Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "on_backorder", label: "On Backorder" },
];

const normalizeStockStatus = (status: string) => {
  const map: Record<string, string> = {
    instock: "in_stock",
    outofstock: "out_of_stock",
    onbackorder: "on_backorder",
    in_stock: "in_stock",
    out_of_stock: "out_of_stock",
    on_backorder: "on_backorder",
  };

  return map[status] || "in_stock";
};

/* ---------- category tree types ---------- */
interface CatNode { id: string; label: string; woo_category_id?: number; children: CatNode[] }

/* ---------- props ---------- */
interface Props {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/* ========== Component ========== */
const ProductDetailSheet = ({ productId, open, onOpenChange, onSaved }: Props) => {
  const { can } = usePermissions();
  const canViewCost = can("products.view_cost");
  const canEditCost = can("products.edit_cost");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushingStock, setPushingStock] = useState(false);
  const [wooUrl, setWooUrl] = useState<string | null>(null);

  // category tree from DB
  const [catTree, setCatTree] = useState<CatNode[]>([]);
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());

  // attribute / variation generation
  const [attrKeys, setAttrKeys] = useState<string[]>(["Size", "Color"]);
  const [attrValues, setAttrValues] = useState<Record<string, string[]>>({ Size: [], Color: [] });
  const [newAttrKey, setNewAttrKey] = useState("");
  const [newValInputs, setNewValInputs] = useState<Record<string, string>>({});

  // measurement groups assigned to this product (direct + via categories)
  const [productGroups, setProductGroups] = useState<MeasurementGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    loadCategories();
    if (productId) {
      loadProduct(productId);
    } else {
      setForm(emptyForm);
      setVariations([]);
      setSelectedCatIds(new Set());
      setAttrKeys(["Size", "Color"]);
      setAttrValues({ Size: [], Color: [] });
    }
  }, [open, productId]);

  const loadCategories = async () => {
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id, woo_category_id")
      .order("name");
    if (!cats) return;

    // Build tree
    const nodeMap = new Map<string, CatNode>();
    const roots: CatNode[] = [];
    for (const c of cats) {
      nodeMap.set(c.id, { id: c.id, label: c.name, woo_category_id: c.woo_category_id ?? undefined, children: [] });
    }
    for (const c of cats) {
      const node = nodeMap.get(c.id)!;
      if (c.parent_id && nodeMap.has(c.parent_id)) {
        nodeMap.get(c.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    setCatTree(roots);
  };

  const loadProduct = async (id: string) => {
    setLoading(true);
    const { data: p } = await supabase.from("products").select("*").eq("id", id).single();
    if (p) {
      setForm({
        id: p.id, name: p.name, sku: p.sku || "", price: Number(p.price),
        cost_price: Number(p.cost_price || 0), description: p.description || "",
        category: p.category || "", image_url: p.image_url || "", barcode: p.barcode || "",
        manage_stock: p.manage_stock ?? true, stock_quantity: p.stock_quantity,
        stock_status: normalizeStockStatus(p.stock_status || "in_stock"), is_active: p.is_active,
      });
    }

    // Load product categories
    const { data: pcData } = await supabase
      .from("product_categories")
      .select("category_id")
      .eq("product_id", id);
    if (pcData) {
      setSelectedCatIds(new Set(pcData.map((pc: any) => pc.category_id)));
    }

    const { data: vars } = await supabase.from("product_variations").select("*").eq("product_id", id).order("created_at");
    if (vars) {
      setVariations(vars.map((v: any) => ({
        id: v.id, woo_variation_id: v.woo_variation_id || null,
        name: v.name, sku: v.sku || "", price: Number(v.price),
        manage_stock: v.manage_stock, stock_quantity: v.stock_quantity,
        stock_status: normalizeStockStatus(v.stock_status || "in_stock"), barcode: v.barcode || "",
        attributes: Array.isArray(v.attributes) ? v.attributes : [],
      })));
      if (vars.length > 0) {
        const attrs = vars[0].attributes as any[];
        if (Array.isArray(attrs) && attrs.length > 0) {
          const keys = [...new Set(vars.flatMap((v: any) => (v.attributes as any[]).map((a: any) => a.key)))];
          setAttrKeys(keys);
          const vals: Record<string, string[]> = {};
          for (const k of keys) {
            vals[k] = [...new Set(vars.flatMap((v: any) => (v.attributes as any[]).filter((a: any) => a.key === k).map((a: any) => a.value)))];
          }
          setAttrValues(vals);
        }
      }
    }
    // Load measurement groups for this product (direct + via categories)
    setGroupsLoading(true);
    try {
      const grps = await getGroupsForProduct(id);
      setProductGroups(grps);
    } catch {
      setProductGroups([]);
    } finally {
      setGroupsLoading(false);
    }
    setLoading(false);
  };

  const set = (key: keyof ProductForm, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  /* ---------- quick stock push ---------- */
  const handleStockStatusChange = async (newStatus: string) => {
    const normalizedStatus = normalizeStockStatus(newStatus);
    set("stock_status", normalizedStatus);

    if (variations.length > 0) {
      setVariations(prev => prev.map(v => ({ ...v, stock_status: normalizedStatus })));
    }

    if (!form.id) return;

    setPushingStock(true);
    try {
      await supabase
        .from("products")
        .update({ stock_status: normalizedStatus })
        .eq("id", form.id);

      if (variations.length > 0) {
        await supabase
          .from("product_variations")
          .update({ stock_status: normalizedStatus })
          .eq("product_id", form.id);
      }

      const { data: prod } = await supabase.from("products").select("woo_product_id, store_id").eq("id", form.id).single();
      if (prod?.woo_product_id && prod?.store_id) {
        const { error } = await supabase.functions.invoke("woo-push", {
          body: { action: "push_stock", product_id: form.id },
        });

        if (error) throw error;

        toast({
          title: variations.length > 0 ? "Product and variations synced to WooCommerce" : "Stock status synced to WooCommerce",
        });
      }
    } catch (e) {
      console.warn("WooCommerce stock push failed:", e);
      toast({ title: "Saved locally, WooCommerce sync failed", variant: "destructive" });
    } finally {
      setPushingStock(false);
    }
  };

  /* ---------- save ---------- */
  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    setSaving(true);

    // Build category string from selected categories for backward compat
    const selectedLabels: string[] = [];
    const collectLabels = (nodes: CatNode[]) => {
      for (const n of nodes) {
        if (selectedCatIds.has(n.id)) selectedLabels.push(n.label);
        collectLabels(n.children);
      }
    };
    collectLabels(catTree);

    const payload = {
      name: form.name, sku: form.sku || null, price: form.price, cost_price: form.cost_price,
      description: form.description || null, category: selectedLabels.join(", ") || null,
      image_url: form.image_url || null, barcode: form.barcode || null,
      manage_stock: form.manage_stock, stock_quantity: form.manage_stock ? form.stock_quantity : 0,
      stock_status: normalizeStockStatus(form.stock_status), is_active: form.is_active,
    };

    let savedId = form.id;
    const isUpdate = !!form.id;
    if (form.id) {
      await supabase.from("products").update(payload).eq("id", form.id);
    } else {
      const { data } = await supabase.from("products").insert(payload).select("id").single();
      savedId = data?.id;
    }
    if (savedId) {
      await logAction(isUpdate ? "update" : "create", "product", savedId, {
        name: payload.name, sku: payload.sku, price: payload.price,
        stock_quantity: payload.stock_quantity, is_active: payload.is_active,
      });
    }

    if (savedId) {
      // Save product_categories
      await supabase.from("product_categories").delete().eq("product_id", savedId);
      if (selectedCatIds.size > 0) {
        const pcRows = Array.from(selectedCatIds).map(catId => ({ product_id: savedId!, category_id: catId }));
        await supabase.from("product_categories").insert(pcRows);
      }

      // Save variations
      await supabase.from("product_variations").delete().eq("product_id", savedId);
      if (variations.length > 0) {
        const rows = variations.map(v => ({
          product_id: savedId!,
          name: v.name, sku: v.sku || null, price: v.price,
          manage_stock: v.manage_stock, stock_quantity: v.manage_stock ? v.stock_quantity : 0,
          stock_status: normalizeStockStatus(v.stock_status), barcode: v.barcode || null,
          attributes: v.attributes,
          woo_variation_id: v.woo_variation_id || null,
        }));
        await supabase.from("product_variations").insert(rows);
      }
    }

    // Push to WooCommerce if product is linked to a store
    if (savedId) {
      const { data: prod } = await supabase.from("products").select("woo_product_id, store_id").eq("id", savedId).single();
      if (prod?.woo_product_id && prod?.store_id) {
        try {
          const { error } = await supabase.functions.invoke("woo-push", {
            body: { action: "push_product", product_id: savedId },
          });

          if (error) throw error;
        } catch (e) {
          console.warn("WooCommerce push failed:", e);
          toast({ title: "Saved locally, but WooCommerce sync failed", variant: "destructive" });
        }
      }
    }

    setSaving(false);
    toast({ title: form.id ? "Product updated & synced" : "Product created" });
    onSaved();
    onOpenChange(false);
  };

  /* ---------- category helpers ---------- */
  const toggleCat = (id: string) => {
    setSelectedCatIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const syncCategories = async () => {
    toast({ title: "Syncing categories…" });
    // Trigger a sync for all stores to refresh categories
    const { data: stores } = await supabase.from("stores").select("id").eq("status", "connected");
    if (stores) {
      for (const s of stores) {
        await supabase.functions.invoke("woo-sync", { body: { store_id: s.id } });
      }
    }
    await loadCategories();
    toast({ title: "Categories synced from WooCommerce" });
  };

  /* ---------- attribute helpers ---------- */
  const addAttributeKey = () => {
    const key = newAttrKey.trim();
    if (key && !attrKeys.includes(key)) {
      setAttrKeys(prev => [...prev, key]);
      setAttrValues(prev => ({ ...prev, [key]: [] }));
      setNewAttrKey("");
    }
  };

  const removeAttributeKey = (key: string) => {
    setAttrKeys(prev => prev.filter(k => k !== key));
    setAttrValues(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const addAttrValue = (key: string) => {
    const val = (newValInputs[key] || "").trim();
    if (!val) return;
    setAttrValues(prev => ({
      ...prev,
      [key]: prev[key]?.includes(val) ? prev[key] : [...(prev[key] || []), val],
    }));
    setNewValInputs(prev => ({ ...prev, [key]: "" }));
  };

  const removeAttrValue = (key: string, val: string) => {
    setAttrValues(prev => ({ ...prev, [key]: (prev[key] || []).filter(v => v !== val) }));
  };

  /* ---------- generate variations ---------- */
  const generateVariations = () => {
    const keys = attrKeys.filter(k => (attrValues[k] || []).length > 0);
    if (keys.length === 0) { toast({ title: "Add attribute values first", variant: "destructive" }); return; }

    const combos: { key: string; value: string }[][] = keys.reduce<{ key: string; value: string }[][]>(
      (acc, key) => {
        const vals = attrValues[key] || [];
        if (acc.length === 0) return vals.map(v => [{ key, value: v }]);
        return acc.flatMap(combo => vals.map(v => [...combo, { key, value: v }]));
      },
      []
    );

    setVariations(combos.map(attrs => ({
      name: attrs.map(a => a.value).join(" / "),
      sku: "", price: form.price, manage_stock: true,
      stock_quantity: 0, stock_status: "in_stock", barcode: "",
      attributes: attrs,
    })));
    toast({ title: `${combos.length} variations generated` });
  };

  /* ---------- variation helpers ---------- */
  const updateVariation = (idx: number, key: keyof Variation, val: any) => {
    setVariations(prev => prev.map((v, i) => i === idx ? { ...v, [key]: val } : v));
  };
  const removeVariation = (idx: number) => setVariations(prev => prev.filter((_, i) => i !== idx));

  /* ---------- render category tree recursively ---------- */
  const renderCatNode = (node: CatNode, depth = 0) => (
    <div key={node.id}>
      <label className="flex items-center gap-2 py-1.5 rounded hover:bg-secondary/50 cursor-pointer" style={{ paddingLeft: `${8 + depth * 20}px` }}>
        <Checkbox checked={selectedCatIds.has(node.id)} onCheckedChange={() => toggleCat(node.id)} />
        <span className={`text-sm text-foreground ${depth === 0 ? "font-medium" : ""}`}>{node.label}</span>
      </label>
      {node.children.map(child => renderCatNode(child, depth + 1))}
    </div>
  );

  /* ---------- render ---------- */
  if (loading) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto flex flex-col">
        <SheetHeader>
          <SheetTitle>{form.id ? "Edit Product" : "Add New Product"}</SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="categories" className="flex-1 mt-4">
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="variations">Variations</TabsTrigger>
            <TabsTrigger value="measurements">Measurements</TabsTrigger>
          </TabsList>

          {/* ===== Tab 1: Categories ===== */}
          <TabsContent value="categories" className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Product Categories</Label>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={syncCategories}>
                <RefreshCw className="h-3 w-3" /> Sync Categories
              </Button>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-1 max-h-64 overflow-y-auto">
              {catTree.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">No categories yet. Click "Sync Categories" to fetch from WooCommerce.</p>
              )}
              {catTree.map(node => renderCatNode(node))}
            </div>

            {selectedCatIds.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selectedCatIds).map(id => {
                  const findLabel = (nodes: CatNode[]): string => {
                    for (const n of nodes) {
                      if (n.id === id) return n.label;
                      const found = findLabel(n.children);
                      if (found) return found;
                    }
                    return "";
                  };
                  const label = findLabel(catTree);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {label || id}
                      <button onClick={() => toggleCat(id)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ===== Tab 2: Basic Info ===== */}
          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Product name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={e => set("sku", e.target.value)} placeholder="SKU-001" />
              </div>
              <div className="space-y-2">
                <Label>Barcode</Label>
                <Input value={form.barcode} onChange={e => set("barcode", e.target.value)} placeholder="Barcode" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Price (BDT)</Label>
                <Input type="number" value={form.price} onChange={e => set("price", Number(e.target.value))} />
              </div>
              {canViewCost && (
                <div className="space-y-2">
                  <Label>Cost Price (BDT)</Label>
                  <Input type="number" value={form.cost_price} onChange={e => set("cost_price", Number(e.target.value))} disabled={!canEditCost} />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="Product description…" />
            </div>
            <div className="space-y-2">
              <Label>Image URL</Label>
              <Input value={form.image_url} onChange={e => set("image_url", e.target.value)} placeholder="https://..." />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={v => set("is_active", v)} />
              <Label>Active (visible in catalog)</Label>
            </div>
          </TabsContent>

          {/* ===== Tab 3: Inventory ===== */}
          <TabsContent value="inventory" className="space-y-6 mt-4">
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Track stock quantity</p>
                  <p className="text-xs text-muted-foreground">Enable to manage inventory levels for this product</p>
                </div>
                <Switch checked={form.manage_stock} onCheckedChange={v => set("manage_stock", v)} />
              </div>

              {form.manage_stock && (
                <div className="space-y-2">
                  <Label>Stock Quantity</Label>
                  <Input type="number" value={form.stock_quantity} onChange={e => set("stock_quantity", Number(e.target.value))} />
                </div>
              )}

              {!form.manage_stock && (
                <p className="text-xs text-muted-foreground">Stock tracking is disabled — quantity won't be enforced.</p>
              )}

              <div className="space-y-2">
                <Label>Stock Status {pushingStock && <span className="text-xs text-muted-foreground ml-2">Syncing…</span>}</Label>
                <Select value={form.stock_status} onValueChange={handleStockStatusChange} disabled={pushingStock}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOCK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Changes auto-sync to WooCommerce.</p>
              </div>
            </div>
          </TabsContent>

          {/* ===== Tab 4: Variations ===== */}
          <TabsContent value="variations" className="space-y-4 mt-4">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Attributes</Label>
              {attrKeys.map(key => (
                <div key={key} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{key}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeAttributeKey(key)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(attrValues[key] || []).map(val => (
                      <Badge key={val} variant="secondary" className="gap-1">
                        {val}
                        <button onClick={() => removeAttrValue(key, val)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Input
                      value={newValInputs[key] || ""}
                      onChange={e => setNewValInputs(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={`Add ${key.toLowerCase()} value…`}
                      className="h-8 text-xs"
                      onKeyDown={e => e.key === "Enter" && addAttrValue(key)}
                    />
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => addAttrValue(key)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="flex gap-1">
                <Input
                  value={newAttrKey}
                  onChange={e => setNewAttrKey(e.target.value)}
                  placeholder="New attribute name…"
                  className="h-8 text-xs"
                  onKeyDown={e => e.key === "Enter" && addAttributeKey()}
                />
                <Button variant="outline" size="sm" className="h-8 px-2 gap-1 text-xs" onClick={addAttributeKey}>
                  <Plus className="h-3 w-3" /> Attribute
                </Button>
              </div>
            </div>

            <Button variant="outline" size="sm" className="gap-1.5" onClick={generateVariations}>
              <Sparkles className="h-3.5 w-3.5" /> Generate Variations
            </Button>

            {variations.length > 0 && (
              <Accordion type="multiple" className="space-y-2">
                {variations.map((v, idx) => (
                  <AccordionItem key={idx} value={`var-${idx}`} className="rounded-lg border border-border px-3">
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{v.name || `Variation ${idx + 1}`}</span>
                        {v.manage_stock && (
                          <Badge variant="secondary" className="text-xs font-mono">{v.stock_quantity} qty</Badge>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3 space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">SKU</Label>
                          <Input value={v.sku} onChange={e => updateVariation(idx, "sku", e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Price (BDT)</Label>
                          <Input type="number" value={v.price} onChange={e => updateVariation(idx, "price", Number(e.target.value))} className="h-8 text-xs" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Barcode</Label>
                          <Input value={v.barcode} onChange={e => updateVariation(idx, "barcode", e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Switch checked={v.manage_stock} onCheckedChange={val => updateVariation(idx, "manage_stock", val)} />
                          <Label className="text-xs">Track Stock</Label>
                        </div>
                        {v.manage_stock && (
                          <div className="w-20">
                            <Input
                              type="number" value={v.stock_quantity}
                              onChange={e => updateVariation(idx, "stock_quantity", Number(e.target.value))}
                              className="h-8 text-xs"
                            />
                          </div>
                        )}
                        <Select value={v.stock_status} onValueChange={val => updateVariation(idx, "stock_status", val)}>
                          <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STOCK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive gap-1" onClick={() => removeVariation(idx)}>
                          <Trash2 className="h-3 w-3" /> Remove
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </TabsContent>

          {/* ===== Tab 5: Measurements ===== */}
          <TabsContent value="measurements" className="space-y-4 mt-4">
            {!form.id ? (
              <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
                Save the product first, then you can configure size-specific measurements here.
              </p>
            ) : groupsLoading ? (
              <p className="text-sm text-muted-foreground">Loading measurement groups…</p>
            ) : productGroups.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg space-y-1">
                <p>No measurement groups assigned to this product.</p>
                <p className="text-xs">Assign groups in <span className="font-medium">Settings → Measurements</span>, either directly or via this product's category.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Define size-specific measurements (e.g. L, XL) for this product. These override the group's default presets and are auto-applied when this product appears in an order with a matching size.
                </p>
                {productGroups.map((g) => (
                  <div key={g.id} className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{g.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{g.fields.length} fields · {g.unit}</p>
                      </div>
                    </div>
                    <SizePresetsEditor
                      groupId={g.id}
                      productId={form.id}
                      fieldNames={g.fields.map((f) => f.name)}
                      unit={g.unit}
                      showGroupDefaultsHint
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <SheetFooter className="mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Product"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default ProductDetailSheet;
