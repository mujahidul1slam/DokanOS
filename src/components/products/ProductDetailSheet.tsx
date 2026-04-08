import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, RefreshCw } from "lucide-react";

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

interface Props {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const ProductDetailSheet = ({ productId, open, onOpenChange, onSaved }: Props) => {
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attrKeys, setAttrKeys] = useState<string[]>(["Size", "Color"]);
  const [newAttrKey, setNewAttrKey] = useState("");

  useEffect(() => {
    if (!open) return;
    if (productId) {
      loadProduct(productId);
    } else {
      setForm(emptyForm);
      setVariations([]);
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
    }
    const { data: vars } = await supabase.from("product_variations").select("*").eq("product_id", id).order("created_at");
    if (vars) {
      setVariations(vars.map((v: any) => ({
        id: v.id, name: v.name, sku: v.sku || "", price: Number(v.price),
        manage_stock: v.manage_stock, stock_quantity: v.stock_quantity,
        stock_status: v.stock_status, barcode: v.barcode || "",
        attributes: Array.isArray(v.attributes) ? v.attributes : [],
      })));
    }
    setLoading(false);
  };

  const set = (key: keyof ProductForm, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      name: form.name, sku: form.sku || null, price: form.price, cost_price: form.cost_price,
      description: form.description || null, category: form.category || null,
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
      // Delete existing variations and re-insert
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

  const addVariation = () => {
    setVariations(prev => [...prev, {
      name: "", sku: "", price: form.price, manage_stock: true,
      stock_quantity: 0, stock_status: "in_stock", barcode: "",
      attributes: attrKeys.map(k => ({ key: k, value: "" })),
    }]);
  };

  const updateVariation = (idx: number, key: keyof Variation, val: any) => {
    setVariations(prev => prev.map((v, i) => i === idx ? { ...v, [key]: val } : v));
  };

  const updateVariationAttr = (vIdx: number, aIdx: number, val: string) => {
    setVariations(prev => prev.map((v, i) => {
      if (i !== vIdx) return v;
      const attrs = [...v.attributes];
      attrs[aIdx] = { ...attrs[aIdx], value: val };
      return { ...v, attributes: attrs, name: attrs.map(a => a.value).filter(Boolean).join(" / ") };
    }));
  };

  const removeVariation = (idx: number) => setVariations(prev => prev.filter((_, i) => i !== idx));

  const addAttributeKey = () => {
    if (newAttrKey.trim() && !attrKeys.includes(newAttrKey.trim())) {
      const key = newAttrKey.trim();
      setAttrKeys(prev => [...prev, key]);
      setVariations(prev => prev.map(v => ({
        ...v, attributes: [...v.attributes, { key, value: "" }],
      })));
      setNewAttrKey("");
    }
  };

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

        <Tabs defaultValue="basic" className="flex-1 mt-4">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="variations">Variations</TabsTrigger>
          </TabsList>

          {/* Tab 1: Basic Info & Categories */}
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
              <div className="flex items-center justify-between">
                <Label>Category</Label>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" /> Sync Categories
                </Button>
              </div>
              <Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Clothing" />
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

          {/* Tab 2: Inventory Rules */}
          <TabsContent value="inventory" className="space-y-6 mt-4">
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Track stock quantity</p>
                  <p className="text-xs text-muted-foreground">Enable to manage inventory levels for this product</p>
                </div>
                <Switch checked={form.manage_stock} onCheckedChange={v => set("manage_stock", v)} />
              </div>

              <div className="space-y-2">
                <Label>Stock Quantity</Label>
                <Input
                  type="number"
                  value={form.stock_quantity}
                  onChange={e => set("stock_quantity", Number(e.target.value))}
                  disabled={!form.manage_stock}
                  className={!form.manage_stock ? "opacity-50" : ""}
                />
                {!form.manage_stock && (
                  <p className="text-xs text-muted-foreground">Stock tracking is disabled — quantity won't be enforced.</p>
                )}
              </div>

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

          {/* Tab 3: Variations */}
          <TabsContent value="variations" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Attribute Keys</Label>
              <div className="flex flex-wrap gap-2">
                {attrKeys.map(k => (
                  <span key={k} className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{k}</span>
                ))}
                <div className="flex gap-1">
                  <Input value={newAttrKey} onChange={e => setNewAttrKey(e.target.value)} placeholder="New attr…" className="h-7 w-28 text-xs" onKeyDown={e => e.key === "Enter" && addAttributeKey()} />
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={addAttributeKey}><Plus className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {variations.map((v, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{v.name || `Variation ${idx + 1}`}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeVariation(idx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Attribute value inputs */}
                  <div className="grid grid-cols-2 gap-2">
                    {v.attributes.map((a, aIdx) => (
                      <div key={a.key} className="space-y-1">
                        <Label className="text-xs">{a.key}</Label>
                        <Input value={a.value} onChange={e => updateVariationAttr(idx, aIdx, e.target.value)} className="h-8 text-xs" placeholder={a.key} />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">SKU</Label>
                      <Input value={v.sku} onChange={e => updateVariation(idx, "sku", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price</Label>
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
                    <div className="w-20">
                      <Input
                        type="number" value={v.stock_quantity}
                        onChange={e => updateVariation(idx, "stock_quantity", Number(e.target.value))}
                        disabled={!v.manage_stock} className={`h-8 text-xs ${!v.manage_stock ? "opacity-50" : ""}`}
                      />
                    </div>
                    <Select value={v.stock_status} onValueChange={val => updateVariation(idx, "stock_status", val)}>
                      <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STOCK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" className="gap-1" onClick={addVariation}>
              <Plus className="h-3.5 w-3.5" /> Add Variation
            </Button>
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
