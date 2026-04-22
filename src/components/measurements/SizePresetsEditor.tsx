import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Ruler } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

export interface SizePresetRow {
  id?: string;
  size_label: string;
  values: { name: string; value: string }[];
  _isNew?: boolean;
  _toDelete?: boolean;
}

interface Props {
  groupId: string;
  /** When provided, presets are scoped to this product (overrides). When omitted, group defaults. */
  productId?: string | null;
  /** Field names from the parent measurement group, used to render value inputs. */
  fieldNames: string[];
  unit?: string;
  /** When true, also reads group defaults for placeholder hints (used in product mode). */
  showGroupDefaultsHint?: boolean;
}

/**
 * Inline editor for size presets within a measurement group. Auto-loads + auto-saves
 * (Save button) so it can be embedded inside both the Settings group card and the
 * Product Detail sheet without coordinating with their own save flows.
 */
export const SizePresetsEditor = ({ groupId, productId = null, fieldNames, unit, showGroupDefaultsHint }: Props) => {
  const [rows, setRows] = useState<SizePresetRow[]>([]);
  const [groupDefaults, setGroupDefaults] = useState<SizePresetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const query = supabase
      .from("measurement_size_presets" as any)
      .select("id, size_label, values, product_id")
      .eq("group_id", groupId);
    const { data } = productId
      ? await query.eq("product_id", productId)
      : await query.is("product_id", null);
    setRows(((data as any[]) || []).map((r) => ({
      id: r.id,
      size_label: r.size_label,
      values: Array.isArray(r.values) ? r.values : [],
    })));

    if (productId && showGroupDefaultsHint) {
      const { data: defs } = await supabase
        .from("measurement_size_presets" as any)
        .select("size_label, values")
        .eq("group_id", groupId)
        .is("product_id", null);
      setGroupDefaults(((defs as any[]) || []).map((r) => ({
        size_label: r.size_label,
        values: Array.isArray(r.values) ? r.values : [],
      })));
    }
    setLoading(false);
  };

  useEffect(() => { if (groupId && !groupId.startsWith("tmp-")) load(); }, [groupId, productId]);

  const addRow = (label?: string) => {
    if (label && rows.some((r) => r.size_label.toLowerCase() === label.toLowerCase() && !r._toDelete)) return;
    const seed = fieldNames.map((n) => ({ name: n, value: "" }));
    // Pre-fill from group defaults if editing product overrides
    const defaultMatch = label ? groupDefaults.find((d) => d.size_label.toLowerCase() === label.toLowerCase()) : null;
    if (defaultMatch) {
      defaultMatch.values.forEach((v) => {
        const idx = seed.findIndex((s) => s.name === v.name);
        if (idx >= 0) seed[idx] = { ...v };
      });
    }
    setRows((prev) => [...prev, { size_label: label || "", values: seed, _isNew: true }]);
  };

  const updateLabel = (idx: number, label: string) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, size_label: label } : r));
  };

  const updateValue = (idx: number, fieldName: string, value: string) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const exists = r.values.find((v) => v.name === fieldName);
      const values = exists
        ? r.values.map((v) => v.name === fieldName ? { ...v, value } : v)
        : [...r.values, { name: fieldName, value }];
      return { ...r, values };
    }));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, _toDelete: true } : r).filter((r) => !(r._toDelete && r._isNew)));
  };

  const save = async () => {
    if (groupId.startsWith("tmp-")) {
      toast.error("Save the measurement group first, then add size presets.");
      return;
    }
    setSaving(true);
    try {
      for (const r of rows) {
        if (r._toDelete && r.id) {
          await supabase.from("measurement_size_presets" as any).delete().eq("id", r.id);
        } else if (r._isNew) {
          if (!r.size_label.trim()) continue;
          await supabase.from("measurement_size_presets" as any).insert({
            group_id: groupId,
            product_id: productId || null,
            size_label: r.size_label.trim(),
            values: r.values.filter((v) => v.value.trim() !== ""),
          } as any);
        } else if (r.id) {
          await supabase.from("measurement_size_presets" as any).update({
            size_label: r.size_label.trim(),
            values: r.values.filter((v) => v.value.trim() !== ""),
          } as any).eq("id", r.id);
        }
      }
      toast.success("Size presets saved");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save presets");
    } finally {
      setSaving(false);
    }
  };

  if (groupId.startsWith("tmp-")) {
    return <p className="text-xs text-muted-foreground italic">Save the group first to add size presets.</p>;
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading presets…</p>;

  if (fieldNames.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Add fields to this group first.</p>;
  }

  const visibleRows = rows.filter((r) => !r._toDelete);
  const usedLabels = new Set(visibleRows.map((r) => r.size_label.toLowerCase()));
  const availableQuickLabels = DEFAULT_SIZE_LABELS.filter((l) => !usedLabels.has(l.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5">
          <Ruler className="h-3.5 w-3.5" /> Size Presets {unit ? `(${unit})` : ""}
        </Label>
        <Button onClick={save} disabled={saving} size="sm" variant="secondary" className="h-7 text-xs">
          {saving ? "Saving…" : "Save Presets"}
        </Button>
      </div>

      {visibleRows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No size presets. {productId ? "These override the group defaults for this product." : "Define standard measurements for sizes like S, M, L, XL."}
        </p>
      )}

      <div className="space-y-2">
        {visibleRows.map((r, idx) => {
          const realIdx = rows.indexOf(r);
          return (
            <div key={r.id || `new-${idx}`} className="rounded-md border border-border bg-background p-2 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={r.size_label}
                  onChange={(e) => updateLabel(realIdx, e.target.value)}
                  placeholder="Size label (e.g. L)"
                  className="h-8 text-xs font-semibold w-32"
                />
                <Button variant="ghost" size="icon" onClick={() => removeRow(realIdx)} className="h-7 w-7 text-destructive ml-auto">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {fieldNames.map((fname) => {
                  const v = r.values.find((x) => x.name === fname)?.value || "";
                  const groupHint = groupDefaults.find((d) => d.size_label.toLowerCase() === r.size_label.toLowerCase())?.values.find((x) => x.name === fname)?.value;
                  return (
                    <div key={fname} className="space-y-0.5">
                      <Label className="text-[10px] text-muted-foreground">{fname}</Label>
                      <Input
                        value={v}
                        onChange={(e) => updateValue(realIdx, fname, e.target.value)}
                        placeholder={groupHint ? `default: ${groupHint}` : ""}
                        className="h-7 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {availableQuickLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-muted-foreground mr-1">Quick add:</span>
          {availableQuickLabels.map((l) => (
            <Button
              key={l}
              type="button"
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => addRow(l)}
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" />{l}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => addRow()}
          >
            <Plus className="h-2.5 w-2.5 mr-0.5" />Custom
          </Button>
        </div>
      )}
    </div>
  );
};

export default SizePresetsEditor;
