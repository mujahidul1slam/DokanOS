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
import { Plus, Trash2, RefreshCw, X, Sparkles } from "lucide-react";

/* ---------- types ---------- */
interface Variation {
  id?: string;
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

/* ---------- sample category tree ---------- */
interface CatNode { id: string; label: string; children?: CatNode[] }
const SAMPLE_CATEGORIES: CatNode[] = [
  { id: "clothing", label: "Clothing", children: [
    { id: "mens", label: "Men's" },
    { id: "womens", label: "Women's" },
    { id: "kids", label: "Kids" },
  ]},
  { id: "electronics", label: "Electronics", children: [
    { id: "phones", label: "Phones" },
    { id: "accessories", label: "Accessories" },
  ]},
  { id: "home", label: "Home & Living" },
  { id: "beauty", label: "Beauty & Health" },
];

/* ---------- props ---------- */
interface Props {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/* ========== Component ========== */
const ProductDetailSheet = ({ productId, open, onOpenChange, onSaved }: Props) => {
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // category tree
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [catTree, setCatTree] = useState<CatNode[]>(SAMPLE_CATEGORIES);

  // attribute / variation generation
  const [attrKeys, setAttrKeys] = useState<string[]>(["Size", "Color"]);
  const [attrValues, setAttrValues] = useState<Record<string, string[]>>({ Size: [], Color: [] });
  const [newAttrKey, setNewAttrKey] = useState("");
  const [newValInputs, setNewValInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (productId) {
      loadProduct(productId);
    } else {
      setForm(emptyForm);
      setVariations([]);
      setSelectedCats(new Set());
      setAttrValues({ Size: [], Color: [] });
    }
  }, [open, productId]);

  const loadProduct = async (id: string) => {
    setLoading(true);
    const { data: p } = await supabase.from("products").select("*").eq("id", id).single();
    if (p) {
      setForm({
        id: p.id, name: p.name, sku: p.sku || "", price: Number(p.price),
        cost_price: Number(p.cost_price || 0), description: p.description || "",
        category: p.category || "", image_url: p.image_url || "", barcode: p.barcode || "",
        manage_stock: p.manage_stock ?? true, stock_quantity: p.stock_quantity,
        stock_status: p.stock_status || "in_stock", is_active: p.is_active,
      });
      if (p.category) setSelectedCats(new Set(p.category.split(",").map((c: string) => c.trim().toLowerCase())));
    }
    const { data: vars } = await supabase.from("product_variations").select("*").eq("product_id", id).order("created_at");
    if (vars) {
      setVariations(vars.map((v: any) => ({
        id: v.id, name: v.name, sku: v.sku || "", price: Number(v.price),
        manage_stock: v.manage_stock, stock_quantity: v.stock_quantity,
        stock_status: v.stock_status, barcode: v.barcode || "",
        attributes: Array.isArray(v.attributes) ? v.attributes : [],
      })));
      // Rebuild attrKeys from existing variations
      if (vars.length > 0) {
        const attrs = vars[0].attributes as any[];
        if (Array.isArray(attrs)) {
          const keys = attrs.map((a: any) => a.key);
          setAttrKeys(keys.length ? keys : ["Size", "Color"]);
        }
      }
    }
    setLoading(false);
  };

  const set = (key: keyof ProductForm, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  /* ---------- save ---------- */
  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    setSaving(true);
    const catString = Array.from(selectedCats).join(", ");
    const payload = {
      name: form.name, sku: form.sku || null, price: form.price, cost_price: form.cost_price,
      description: form.description || null, category: catString || null,
      image_url: form.image_url || null, barcode: form.barcode || null,
      manage_stock: form.manage_stock, stock_quantity: form.manage_stock ? form.stock_quantity : 0,
      stock_status: form.stock_status, is_active: form.is_active,
    };

    let savedId = form.id;
    if (form.id) {
      await supabase.from("products").update(payload).eq("id", form.id);
    } else {
      const { data } = await supabase.from("products").insert(payload).select("id").single();
      savedId = data?.id;
    }

    if (savedId) {
      await supabase.from("product_variations").delete().eq("product_id", savedId);
      if (variations.length > 0) {
        const rows = variations.map(v => ({
          product_id: savedId!,
          name: v.name, sku: v.sku || null, price: v.price,
          manage_stock: v.manage_stock, stock_quantity: v.manage_stock ? v.stock_quantity : 0,
          stock_status: v.stock_status, barcode: v.barcode || null,
          attributes: v.attributes,
        }));
        await supabase.from("product_variations").insert(rows);
      }
    }

    setSaving(false);
    toast({ title: form.id ? "Product updated" : "Product created" });
    onSaved();
    onOpenChange(false);
  };

  /* ---------- category helpers ---------- */
  const toggleCat = (id: string) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const syncCategories = () => {
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

    // Cartesian product
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
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="variations">Variations</TabsTrigger>
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
              {catTree.map(parent => (
                <div key={parent.id}>
                  <label className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-secondary/50 cursor-pointer">
                    <Checkbox checked={selectedCats.has(parent.id)} onCheckedChange={() => toggleCat(parent.id)} />
                    <span className="text-sm text-foreground font-medium">{parent.label}</span>
                  </label>
                  {parent.children?.map(child => (
                    <label key={child.id} className="flex items-center gap-2 py-1.5 pl-7 pr-1 rounded hover:bg-secondary/50 cursor-pointer">
                      <Checkbox checked={selectedCats.has(child.id)} onCheckedChange={() => toggleCat(child.id)} />
                      <span className="text-sm text-foreground">{child.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            {selectedCats.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(selectedCats).map(id => (
                  <Badge key={id} variant="secondary" className="gap-1 capitalize">
                    {id}
                    <button onClick={() => toggleCat(id)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
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
              <div className="space-y-2">
                <Label>Cost Price (BDT)</Label>
                <Input type="number" value={form.cost_price} onChange={e => set("cost_price", Number(e.target.value))} />
              </div>
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
                  <Input
                    type="number"
                    value={form.stock_quantity}
                    onChange={e => set("stock_quantity", Number(e.target.value))}
                  />
                </div>
              )}

              {!form.manage_stock && (
                <p className="text-xs text-muted-foreground">Stock tracking is disabled — quantity won't be enforced.</p>
              )}

              <div className="space-y-2">
                <Label>Stock Status</Label>
                <Select value={form.stock_status} onValueChange={v => set("stock_status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOCK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">"On Backorder" can be set regardless of stock quantity.</p>
              </div>
            </div>
          </TabsContent>

          {/* ===== Tab 4: Variations ===== */}
          <TabsContent value="variations" className="space-y-4 mt-4">
            {/* Attribute tag inputs */}
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

              {/* Add new attribute key */}
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

            {/* Generate button */}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={generateVariations}>
              <Sparkles className="h-3.5 w-3.5" /> Generate Variations
            </Button>

            {/* Variations accordion */}
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
