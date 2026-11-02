import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, Tag, Package, Layers, Copy, Ban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import SizePresetsEditor from "@/components/measurements/SizePresetsEditor";
import { useRegisterDirty } from "@/hooks/useSettingsDirty";
import { SettingsSaveHandler } from "./SettingsSection";
import { loadMeasurementRulesConfig, saveMeasurementRulesConfig } from "@/lib/measurements";
import {
  getDescendantIds,
  type CategoryNode,
  type CategoryScopeRule,
  type MeasurementRulesConfig,
  type MeasurementScope,
} from "@/lib/measurementRules";

interface Assignment {
  id?: string;
  product_id?: string | null;
  category_id?: string | null;
  /** Category rows only; lives in the measurement_rules config, not the row. */
  scope?: MeasurementScope;
  included_category_ids?: string[];
  excluded_category_ids?: string[];
  _isNew?: boolean;
  _toDelete?: boolean;
}

interface Group {
  id: string;
  name: string;
  display_format: "label_value" | "dash_separated";
  unit: string;
  sort_order: number;
  fields: { id: string; name: string; sort_order: number; _isNew?: boolean }[];
  assignments: Assignment[];
}

interface SimpleProduct { id: string; name: string }
interface SimpleCategory { id: string; name: string; store_id: string | null; parent_id?: string | null }

/** Scope prompt modes for assigning a group to a category that has subcategories. */
type ScopeMode = "all" | "selected" | "except";

interface ScopePromptState {
  groupId: string;
  categoryId: string;
  mode: ScopeMode;
  /** Descendant category ids: included (mode "selected") or excluded (mode "except"). */
  checkedIds: string[];
}

const MeasurementsTab = () => {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [products, setProducts] = useState<SimpleProduct[]>([]);
  const [categories, setCategories] = useState<SimpleCategory[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [slipTpl, setSlipTpl] = useState<any>({});
  const [neverMeasureIds, setNeverMeasureIds] = useState<string[]>([]);
  const [scopePrompt, setScopePrompt] = useState<ScopePromptState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const setDirty = useRegisterDirty();

  const load = async () => {
    setLoading(true);
    const [settingsRes, groupsRes, fieldsRes, assignsRes, prodRes, catRes, storeRes, rules] = await Promise.all([
      supabase.from("invoice_settings" as any).select("id, pos_custom_measurements_enabled, measurement_slip_template").limit(1).single(),
      supabase.from("measurement_groups" as any).select("*").order("sort_order"),
      supabase.from("measurement_fields" as any).select("*").order("sort_order"),
      supabase.from("measurement_assignments" as any).select("*"),
      supabase.from("products").select("id, name").eq("is_active", true).order("name"),
      supabase.from("categories").select("id, name, store_id, parent_id").order("name"),
      supabase.from("stores").select("id, name"),
      loadMeasurementRulesConfig(),
    ]);

    if ((settingsRes as any).data) {
      setSettingsId((settingsRes as any).data.id);
      setGlobalEnabled((settingsRes as any).data.pos_custom_measurements_enabled ?? true);
      setSlipTpl((settingsRes as any).data.measurement_slip_template || {});
    }

    const fieldsByGroup = new Map<string, any[]>();
    ((fieldsRes as any).data || []).forEach((f: any) => {
      if (!fieldsByGroup.has(f.group_id)) fieldsByGroup.set(f.group_id, []);
      fieldsByGroup.get(f.group_id)!.push(f);
    });
    const assignsByGroup = new Map<string, Assignment[]>();
    ((assignsRes as any).data || []).forEach((a: any) => {
      const scopeRule: CategoryScopeRule | undefined = rules.categoryScopes[a.id];
      const enriched: Assignment = {
        ...a,
        scope: scopeRule?.scope ?? "direct",
        included_category_ids: scopeRule?.includedCategoryIds ?? [],
        excluded_category_ids: scopeRule?.excludedCategoryIds ?? [],
      };
      if (!assignsByGroup.has(a.group_id)) assignsByGroup.set(a.group_id, []);
      assignsByGroup.get(a.group_id)!.push(enriched);
    });

    setGroups(((groupsRes as any).data || []).map((g: any) => ({
      ...g,
      fields: (fieldsByGroup.get(g.id) || []).sort((a, b) => a.sort_order - b.sort_order),
      assignments: assignsByGroup.get(g.id) || [],
    })));
    setProducts((prodRes.data || []) as any);
    setCategories((catRes.data || []) as any);
    setStores((storeRes.data || []) as any);
    setNeverMeasureIds(Object.keys(rules.productOverrides));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => () => setDirty(false), [setDirty]);

  const markDirty = () => setDirty(true);

  const addGroup = () => {
    const tmp: Group = {
      id: `tmp-${crypto.randomUUID()}`,
      name: "New Group",
      display_format: "label_value",
      unit: "in",
      sort_order: groups.length,
      fields: [],
      assignments: [],
    };
    setGroups([...groups, tmp]);
    markDirty();
  };

  const updateGroup = (id: string, patch: Partial<Group>) => {
    setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    markDirty();
  };

  const deleteGroup = async (id: string) => {
    if (!confirm("Delete this measurement group? It will be removed from all assigned products.")) return;
    if (!id.startsWith("tmp-")) {
      await supabase.from("measurement_groups" as any).delete().eq("id", id);
    }
    setGroups(groups.filter((g) => g.id !== id));
    markDirty();
    toast.success("Group deleted");
  };

  const duplicateGroup = (id: string) => {
    const src = groups.find((g) => g.id === id);
    if (!src) return;
    const copy: Group = {
      id: `tmp-${crypto.randomUUID()}`,
      name: `${src.name} (Copy)`,
      display_format: src.display_format,
      unit: src.unit,
      sort_order: groups.length,
      fields: src.fields.map((f, i) => ({
        id: `tmp-${crypto.randomUUID()}`,
        name: f.name,
        sort_order: i,
        _isNew: true,
      })),
      // Don't copy assignments — duplicate is unassigned by default
      assignments: [],
    };
    const idx = groups.findIndex((g) => g.id === id);
    const next = [...groups];
    next.splice(idx + 1, 0, copy);
    setGroups(next);
    markDirty();
    toast.success("Group duplicated — remember to Save");
  };

  const addField = (groupId: string) => {
    setGroups(groups.map((g) => g.id === groupId ? {
      ...g,
      fields: [...g.fields, { id: `tmp-${crypto.randomUUID()}`, name: "", sort_order: g.fields.length, _isNew: true }],
    } : g));
    markDirty();
  };

  const updateField = (groupId: string, fieldId: string, name: string) => {
    setGroups(groups.map((g) => g.id === groupId ? {
      ...g,
      fields: g.fields.map((f) => f.id === fieldId ? { ...f, name } : f),
    } : g));
    markDirty();
  };

  const deleteField = async (groupId: string, fieldId: string) => {
    if (!fieldId.startsWith("tmp-")) {
      await supabase.from("measurement_fields" as any).delete().eq("id", fieldId);
    }
    setGroups(groups.map((g) => g.id === groupId ? {
      ...g, fields: g.fields.filter((f) => f.id !== fieldId),
    } : g));
    markDirty();
  };

  const toggleAssignment = (groupId: string, kind: "product" | "category", targetId: string) => {
    markDirty();
    setGroups(groups.map((g) => {
      if (g.id !== groupId) return g;
      const key = kind === "product" ? "product_id" : "category_id";
      const existing = g.assignments.find((a) => (a as any)[key] === targetId && !a._toDelete);
      if (existing) {
        if (existing._isNew) {
          return { ...g, assignments: g.assignments.filter((a) => a !== existing) };
        }
        return { ...g, assignments: g.assignments.map((a) => a === existing ? { ...a, _toDelete: true } : a) };
      }
      return {
        ...g,
        assignments: [...g.assignments, { _isNew: true, [key]: targetId, [kind === "product" ? "category_id" : "product_id"]: null } as any],
      };
    }));
  };

  /** Categories with subcategories get the scope prompt; leaves assign directly. */
  const onCategoryToggle = (groupId: string, categoryId: string) => {
    const group = groups.find((g) => g.id === groupId);
    const existing = group?.assignments.find((a) => a.category_id === categoryId && !a._toDelete);
    if (existing) {
      toggleAssignment(groupId, "category", categoryId);
      return;
    }
    const hasChildren = categories.some((c) => c.parent_id === categoryId);
    if (hasChildren) {
      setScopePrompt({ groupId, categoryId, mode: "all", checkedIds: [] });
    markDirty();
    } else {
      toggleAssignment(groupId, "category", categoryId);
    }
  };

  /** Reopen the scope prompt pre-filled for an existing scoped assignment. */
  const editAssignmentScope = (groupId: string, a: Assignment) => {
    if (!a.category_id) return;
    const mode: ScopeMode =
      a.scope === "cascade_selected" ? "selected" : a.scope === "cascade_except" ? "except" : "all";
    setScopePrompt({
      groupId,
      categoryId: a.category_id,
      mode,
      checkedIds: mode === "selected" ? a.included_category_ids ?? [] : a.excluded_category_ids ?? [],
    });
  };

  /** Apply the prompt's scope choice to the (new or existing) category assignment. */
  const applyScopePrompt = () => {
    const p = scopePrompt;
    if (!p) return;
    const scope: MeasurementScope =
      p.mode === "all" ? "cascade_all" : p.mode === "selected" ? "cascade_selected" : "cascade_except";
    markDirty();
    setGroups(groups.map((g) => {
      if (g.id !== p.groupId) return g;
      const existing = g.assignments.find((a) => a.category_id === p.categoryId && !a._toDelete);
      const row: Assignment = {
        id: existing?.id,
        _isNew: existing?._isNew ?? true,
        product_id: null,
        category_id: p.categoryId,
        scope,
        included_category_ids: p.mode === "selected" ? p.checkedIds : [],
        excluded_category_ids: p.mode === "except" ? p.checkedIds : [],
      };
      if (existing) {
        return { ...g, assignments: g.assignments.map((a) => (a === existing ? row : a)) };
      }
      return { ...g, assignments: [...g.assignments, row] };
    }));
    setScopePrompt(null);
  };

  /** Per-product never-measure override — wins over every group assignment. */
  const toggleNeverMeasure = (productId: string) => {
    setNeverMeasureIds((prev) =>
      prev.includes(productId) ? prev.filter((x) => x !== productId) : [...prev, productId]
    );
    markDirty();
  };

  /** Depth of a category in the tree (roots are 0), cycle-safe. */
  const categoryDepth = (categoryId: string): number => {
    let depth = 0;
    let cur = categories.find((c) => c.id === categoryId);
    const seen = new Set<string>();
    while (cur?.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      depth++;
      cur = categories.find((c) => c.id === cur!.parent_id);
    }
    return depth;
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // Save settings + slip template + toggle
      if (settingsId) {
        await supabase.from("invoice_settings" as any).update({
          pos_custom_measurements_enabled: globalEnabled,
          measurement_slip_template: slipTpl,
        } as any).eq("id", settingsId);
      }

      // Persist each group
      const savedCategoryAssignments: { a: Assignment; rowId: string }[] = [];
      for (const g of groups) {
        let groupId = g.id;
        if (g.id.startsWith("tmp-")) {
          const { data, error } = await supabase.from("measurement_groups" as any).insert({
            name: g.name, display_format: g.display_format, unit: g.unit, sort_order: g.sort_order,
          } as any).select("id").single();
          if (error || !data) throw error;
          groupId = (data as any).id;
        } else {
          await supabase.from("measurement_groups" as any).update({
            name: g.name, display_format: g.display_format, unit: g.unit, sort_order: g.sort_order,
          } as any).eq("id", g.id);
        }

        // Fields
        for (let i = 0; i < g.fields.length; i++) {
          const f = g.fields[i];
          if (!f.name.trim()) continue;
          if (f.id.startsWith("tmp-")) {
            await supabase.from("measurement_fields" as any).insert({ group_id: groupId, name: f.name.trim(), sort_order: i } as any);
          } else {
            await supabase.from("measurement_fields" as any).update({ name: f.name.trim(), sort_order: i } as any).eq("id", f.id);
          }
        }

        // Assignments
        for (const a of g.assignments) {
          if (a._toDelete && a.id) {
            await supabase.from("measurement_assignments" as any).delete().eq("id", a.id);
          } else if (a._isNew) {
            const { data: row, error: aErr } = await supabase.from("measurement_assignments" as any).insert({
              group_id: groupId,
              product_id: a.product_id || null,
              category_id: a.category_id || null,
            } as any).select("id").single();
            if (aErr || !row) throw aErr;
            savedCategoryAssignments.push({ a, rowId: (row as any).id });
          } else if (!a._toDelete && a.category_id && a.id) {
            savedCategoryAssignments.push({ a, rowId: a.id });
          }
        }
      }

      // Scope modifiers + product never-measure overrides live in the
      // measurement_rules app_settings row (keyed by assignment row id).
      const categoryScopes: Record<string, CategoryScopeRule> = {};
      for (const { a, rowId } of savedCategoryAssignments) {
        const scope = a.scope ?? "direct";
        const includedCategoryIds = a.included_category_ids ?? [];
        const excludedCategoryIds = a.excluded_category_ids ?? [];
        if (scope === "direct" && includedCategoryIds.length === 0 && excludedCategoryIds.length === 0) continue;
        categoryScopes[rowId] = {
          scope: scope as CategoryScopeRule["scope"],
          includedCategoryIds,
          excludedCategoryIds,
        };
      }
      const rulesConfig: MeasurementRulesConfig = {
        categoryScopes,
        productOverrides: Object.fromEntries(neverMeasureIds.map((id) => [id, { neverMeasure: true }])),
      };
      await saveMeasurementRulesConfig(rulesConfig);

      toast.success("Measurement settings saved");
      setDirty(false);
      load();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading…</div>;

  // Group categories by store for the picker
  const catsByStore = new Map<string, SimpleCategory[]>();
  categories.forEach((c) => {
    const k = c.store_id || "_local";
    if (!catsByStore.has(k)) catsByStore.set(k, []);
    catsByStore.get(k)!.push(c);
  });

  return (
    <div className="space-y-4">
      {/* Global toggle */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Custom Measurements</h2>
          <p className="text-sm text-muted-foreground">Enable measurement capture in POS and configure measurement groups.</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Enable in POS</Label>
            <p className="text-xs text-muted-foreground">Show the Custom Measurements toggle in the POS variation dialog.</p>
          </div>
          <Switch checked={globalEnabled} onCheckedChange={(value) => { setGlobalEnabled(value); markDirty(); }} />
        </div>
      </div>

      {/* Groups */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold mb-1">Measurement Groups</h2>
            <p className="text-sm text-muted-foreground">Each group is a named set of fields (e.g. "Pant Measurements") assignable to products or categories.</p>
          </div>
          <Button onClick={addGroup} size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> New Group</Button>
        </div>

        {groups.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
            No measurement groups yet. Create one to get started.
          </div>
        )}

        <div className="space-y-3">
          {groups.map((g) => {
            const productAssignedIds = g.assignments.filter((a) => !a._toDelete && a.product_id).map((a) => a.product_id!);
            const categoryAssignments = g.assignments.filter((a) => !a._toDelete && a.category_id);
            const categoryAssignedIds = categoryAssignments.map((a) => a.category_id!);
            return (
              <div key={g.id} className="rounded-lg border border-border bg-secondary/30 p-4 space-y-4">
                {/* Group header */}
                <div className="grid grid-cols-12 gap-3 items-end">
                  <div className="col-span-5 space-y-1">
                    <Label className="text-xs">Group Name</Label>
                    <Input value={g.name} onChange={(e) => updateGroup(g.id, { name: e.target.value })} className="h-9" />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Display Format</Label>
                    <Select value={g.display_format} onValueChange={(v: any) => updateGroup(g.id, { display_format: v })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="label_value">Name: Value</SelectItem>
                        <SelectItem value="dash_separated">Value-Value-Value</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Input value={g.unit} onChange={(e) => updateGroup(g.id, { unit: e.target.value })} className="h-9" placeholder="in" />
                  </div>
                  <div className="col-span-2 flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => duplicateGroup(g.id)} title="Duplicate group" aria-label="Duplicate group">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteGroup(g.id)} className="text-destructive" title="Delete group" aria-label="Delete group">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Fields */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Fields</Label>
                    <Button variant="ghost" size="sm" onClick={() => addField(g.id)} className="h-7 gap-1 text-xs">
                      <Plus className="h-3 w-3" /> Add Field
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {g.fields.length === 0 ? (
                      <p className="col-span-3 text-xs text-muted-foreground italic">No fields yet</p>
                    ) : g.fields.map((f) => (
                      <div key={f.id} className="flex items-center gap-1">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <Input
                          value={f.name}
                          onChange={(e) => updateField(g.id, f.id, e.target.value)}
                          className="h-8 text-xs"
                          placeholder="Field name"
                        />
                        <Button variant="ghost" size="icon" onClick={() => deleteField(g.id, f.id)} className="h-7 w-7 text-destructive" aria-label="Delete field">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assignments */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Categories */}
                  <div>
                    <Label className="text-xs flex items-center gap-1.5 mb-2"><Tag className="h-3.5 w-3.5" /> Categories</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full justify-start h-8 font-normal text-xs">
                          {categoryAssignedIds.length === 0 ? "Select categories…" : `${categoryAssignedIds.length} selected`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-h-96 overflow-y-auto p-0" align="start">
                        <div className="p-2">
                          {Array.from(catsByStore.entries()).map(([storeId, cats]) => {
                            const storeName = stores.find((s) => s.id === storeId)?.name || "Local";
                            return (
                              <div key={storeId} className="mb-2">
                                <div className="text-[10px] font-semibold uppercase text-muted-foreground px-2 py-1">{storeName}</div>
                                {cats.map((c) => (
                                  <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary cursor-pointer text-xs">
                                    <Checkbox
                                      checked={categoryAssignedIds.includes(c.id)}
                                      onCheckedChange={() => onCategoryToggle(g.id, c.id)}
                                    />
                                    <span className="truncate">{c.name}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                    {categoryAssignedIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {categoryAssignments.slice(0, 5).map((a) => {
                          const cat = categories.find((c) => c.id === a.category_id);
                          const suffix =
                            a.scope === "cascade_all" ? " · all subcategories"
                            : a.scope === "cascade_selected" ? ` · ${a.included_category_ids?.length ?? 0} selected`
                            : a.scope === "cascade_except" ? ` · except ${(a.excluded_category_ids ?? []).length}`
                            : "";
                          return (
                            <Badge key={a.category_id} variant="secondary" className="text-[10px] gap-1">
                              <span className="truncate">{cat?.name || "?"}{suffix}</span>
                              {a.scope && a.scope !== "direct" && (
                                <button
                                  type="button"
                                  onClick={() => editAssignmentScope(g.id, a)}
                                  className="ml-0.5 hover:text-foreground"
                                  aria-label={`Edit subcategory scope for ${cat?.name || "category"}`}
                                >
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </Badge>
                          );
                        })}
                        {categoryAssignments.length > 5 && <Badge variant="secondary" className="text-[10px]">+{categoryAssignments.length - 5}</Badge>}
                      </div>
                    )}
                  </div>

                  {/* Products */}
                  <div>
                    <Label className="text-xs flex items-center gap-1.5 mb-2"><Package className="h-3.5 w-3.5" /> Specific Products</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full justify-start h-8 font-normal text-xs">
                          {productAssignedIds.length === 0 ? "Select products…" : `${productAssignedIds.length} selected`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-h-96 overflow-y-auto p-2" align="start">
                        {products.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary cursor-pointer text-xs">
                            <Checkbox
                              checked={productAssignedIds.includes(p.id)}
                              onCheckedChange={() => toggleAssignment(g.id, "product", p.id)}
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        ))}
                      </PopoverContent>
                    </Popover>
                    {productAssignedIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {productAssignedIds.slice(0, 5).map((id) => (
                          <Badge key={id} variant="secondary" className="text-[10px]">
                            {products.find((p) => p.id === id)?.name || "?"}
                          </Badge>
                        ))}
                        {productAssignedIds.length > 5 && <Badge variant="secondary" className="text-[10px]">+{productAssignedIds.length - 5}</Badge>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Size presets */}
                <div className="rounded-md border border-border bg-background/60 p-3">
                  <SizePresetsEditor
                    groupId={g.id}
                    fieldNames={g.fields.map((f) => f.name).filter(Boolean)}
                    unit={g.unit}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Product overrides */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Product Overrides</h2>
          <p className="text-sm text-muted-foreground">
            Products that never need measurements. A never-measure override wins over every category and product
            assignment; measurements can still be captured later at the order level.
          </p>
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1.5 mb-2"><Ban className="h-3.5 w-3.5" /> Never measure</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-start h-8 font-normal text-xs">
                {neverMeasureIds.length === 0
                  ? "Select products…"
                  : `${neverMeasureIds.length} product${neverMeasureIds.length === 1 ? "" : "s"} never measured`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 max-h-96 overflow-y-auto p-2" align="start">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-secondary cursor-pointer text-xs">
                  <Checkbox
                    checked={neverMeasureIds.includes(p.id)}
                    onCheckedChange={() => toggleNeverMeasure(p.id)}
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
          {neverMeasureIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {neverMeasureIds.map((id) => (
                <Badge key={id} variant="secondary" className="text-[10px] gap-1">
                  <span className="truncate">{products.find((p) => p.id === id)?.name || "?"}</span>
                  <button
                    type="button"
                    onClick={() => toggleNeverMeasure(id)}
                    className="ml-0.5 hover:text-foreground"
                    aria-label="Remove never-measure override"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slip template */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold mb-1">Measurement Slip Template</h2>
          <p className="text-sm text-muted-foreground">Customize how measurement slips are printed for craftsmen.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Slip Title</Label>
            <Input value={slipTpl.title || ""} onChange={(e) => { setSlipTpl({ ...slipTpl, title: e.target.value }); markDirty(); }} placeholder="MEASUREMENT SLIP" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Print Format</Label>
            <Select value={slipTpl.print_format || "thermal"} onValueChange={(v) => { setSlipTpl({ ...slipTpl, print_format: v }); markDirty(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="thermal">Thermal (80mm)</SelectItem>
                <SelectItem value="a4">A4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs">Default Display Format Override</Label>
            <Select value={slipTpl.default_format || "per_group"} onValueChange={(v) => { setSlipTpl({ ...slipTpl, default_format: v }); markDirty(); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="per_group">Use each group's own format</SelectItem>
                <SelectItem value="label_value">Force Name: Value for all</SelectItem>
                <SelectItem value="dash_separated">Force Value-Value-Value for all</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {[
            ["show_order_number", "Order Number"],
            ["show_order_date", "Order Date"],
            ["show_customer_name", "Customer Name"],
            ["show_customer_phone", "Customer Phone"],
            ["show_product_name", "Product Name"],
            ["show_product_sku", "Product SKU"],
            ["show_notes", "Measurement Notes"],
             ["show_brand", "Brand name & logo"],
             ["show_pathao_account", "Pathao Account"],
             ["bold_thermal_text", "Bold thermal text (thermal)"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Switch
                checked={slipTpl[key] !== false}
                onCheckedChange={(v) => { setSlipTpl({ ...slipTpl, [key]: v }); markDirty(); }}
              />
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Footer Text</Label>
          <Textarea value={slipTpl.footer_text || ""} onChange={(e) => { setSlipTpl({ ...slipTpl, footer_text: e.target.value }); markDirty(); }} rows={2} />
        </div>
      </div>

      {/* Category scope prompt (issue #28): main-category assignment asks how to cascade */}
      <Dialog open={!!scopePrompt} onOpenChange={(open) => { if (!open) setScopePrompt(null); }}>
        <DialogContent className="max-w-lg">
          {scopePrompt && (() => {
            const cat = categories.find((c) => c.id === scopePrompt.categoryId);
            const descendants = getDescendantIds(categories as CategoryNode[], scopePrompt.categoryId)
              .map((id) => categories.find((c) => c.id === id))
              .filter((c): c is SimpleCategory => !!c);
            const rootDepth = categoryDepth(scopePrompt.categoryId);
            const toggleChecked = (id: string) => {
              setScopePrompt((p) => (p ? {
                ...p,
                checkedIds: p.checkedIds.includes(id)
                  ? p.checkedIds.filter((x) => x !== id)
                  : [...p.checkedIds, id],
              } : p));
            };
            return (
              <>
                <DialogHeader>
                  <DialogTitle>How should this group apply to "{cat?.name}"?</DialogTitle>
                  <DialogDescription>
                    This category has subcategories. Choose how far the assignment reaches —
                    subcategories created later are resolved when products are measured, so nothing is frozen here.
                  </DialogDescription>
                </DialogHeader>

                <RadioGroup
                  value={scopePrompt.mode}
                  onValueChange={(v) => setScopePrompt((p) => (p ? { ...p, mode: v as ScopeMode } : p))}
                  className="space-y-3"
                >
                  <label className="flex items-start gap-2 cursor-pointer">
                    <RadioGroupItem value="all" className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">All subcategories</div>
                      <p className="text-xs text-muted-foreground">
                        Applies to this category and every subcategory, including ones created later.
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <RadioGroupItem value="selected" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Selected subcategories</div>
                      <p className="text-xs text-muted-foreground">
                        Applies to this category and only the subcategories you pick
                        (a pick includes that subcategory's own subcategories).
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <RadioGroupItem value="except" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">All except excluded</div>
                      <p className="text-xs text-muted-foreground">
                        Applies everywhere below this category except the subcategories you exclude
                        (an exclusion covers that subcategory's own subcategories too).
                      </p>
                    </div>
                  </label>
                </RadioGroup>

                {(scopePrompt.mode === "selected" || scopePrompt.mode === "except") && (
                  <div className="rounded-md border border-border p-2 max-h-56 overflow-y-auto">
                    {descendants.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-2">
                        "{cat?.name}" has no subcategories yet.
                      </p>
                    ) : descendants.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary cursor-pointer text-xs"
                        style={{ paddingLeft: `${(Math.max(0, categoryDepth(d.id) - rootDepth) * 14) + 4}px` }}
                      >
                        <Checkbox
                          checked={scopePrompt.checkedIds.includes(d.id)}
                          onCheckedChange={() => toggleChecked(d.id)}
                        />
                        <span className="truncate">{d.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setScopePrompt(null)}>Cancel</Button>
                  <Button size="sm" onClick={applyScopePrompt}>Apply</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Universal save: the sticky save bar commits groups, fields,
          assignments and the slip template together. Destructive flows
          (delete/duplicate group) stay draft-based and "remember to Save"
          now means the save bar. */}
      <SettingsSaveHandler label="Save Measurements" disabled={saving} run={saveAll} />
    </div>
  );
};

export default MeasurementsTab;
