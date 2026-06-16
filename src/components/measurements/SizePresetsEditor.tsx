import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Ruler, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_SIZE_LABELS = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];

interface PresetRow {
  id: string;          // DB id (or local "new-...") — stable React key
  dbId?: string;       // actual id in DB once persisted
  size_label: string;
  values: { name: string; value: string }[];
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
 * Inline editor for size presets within a measurement group.
 *
 * Auto-saves: every change (add row, edit label, edit value, delete row) is
 * persisted immediately so the user never loses input. A small status indicator
 * shows the save state. This avoids confusion with the parent "Save All" button.
 */
export const SizePresetsEditor = ({ groupId, productId = null, fieldNames, unit, showGroupDefaultsHint }: Props) => {
  const [rows, setRows] = useState<PresetRow[]>([]);
  const [groupDefaults, setGroupDefaults] = useState<{ size_label: string; values: { name: string; value: string }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  // Debounce per-row writes so typing doesn't spam the DB.
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
      dbId: r.id,
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

  useEffect(() => {
    if (groupId && !groupId.startsWith("tmp-")) load();
    return () => {
      // Flush timers on unmount
      writeTimers.current.forEach((t) => clearTimeout(t));
      writeTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, productId]);

  const markSaving = (rowId: string, on: boolean) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowId); else next.delete(rowId);
      return next;
    });
  };

  /** Persist a single row immediately (insert or update). Updates dbId on insert. */
  const persistRow = async (row: PresetRow) => {
    if (!row.size_label.trim()) return; // require a label before saving
    markSaving(row.id, true);
    try {
      const cleanValues = row.values.filter((v) => v.value.trim() !== "");
      if (row.dbId) {
        const { error } = await supabase
          .from("measurement_size_presets" as any)
          .update({ size_label: row.size_label.trim(), values: cleanValues } as any)
          .eq("id", row.dbId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("measurement_size_presets" as any)
          .insert({
            group_id: groupId,
            product_id: productId || null,
            size_label: row.size_label.trim(),
            values: cleanValues,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        const newDbId = (data as any).id;
        setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, dbId: newDbId } : r));
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to save preset");
    } finally {
      markSaving(row.id, false);
    }
  };

  /** Schedule a debounced persist for a row (used while typing). */
  const scheduleSave = (rowId: string) => {
    const existing = writeTimers.current.get(rowId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      writeTimers.current.delete(rowId);
      // Read latest row from state at fire time
      setRows((prev) => {
        const r = prev.find((x) => x.id === rowId);
        if (r) persistRow(r);
        return prev;
      });
    }, 600);
    writeTimers.current.set(rowId, t);
  };

  const addRow = async (label?: string) => {
    if (groupId.startsWith("tmp-")) {
      toast.error("Save the measurement group first, then add size presets.");
      return;
    }
    if (label && rows.some((r) => r.size_label.toLowerCase() === label.toLowerCase())) return;
    const seed = fieldNames.map((n) => ({ name: n, value: "" }));
    const defaultMatch = label ? groupDefaults.find((d) => d.size_label.toLowerCase() === label.toLowerCase()) : null;
    if (defaultMatch) {
      defaultMatch.values.forEach((v) => {
        const idx = seed.findIndex((s) => s.name === v.name);
        if (idx >= 0) seed[idx] = { ...v };
      });
    }
    const localId = `new-${crypto.randomUUID()}`;
    const newRow: PresetRow = { id: localId, size_label: label || "", values: seed };
    setRows((prev) => [...prev, newRow]);
    // If a label was supplied (quick-add), insert immediately so it survives.
    if (label) await persistRow(newRow);
  };

  const updateLabel = (rowId: string, label: string) => {
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, size_label: label } : r));
    scheduleSave(rowId);
  };

  const updateValue = (rowId: string, fieldName: string, value: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const exists = r.values.find((v) => v.name === fieldName);
      const values = exists
        ? r.values.map((v) => v.name === fieldName ? { ...v, value } : v)
        : [...r.values, { name: fieldName, value }];
      return { ...r, values };
    }));
    scheduleSave(rowId);
  };

  const removeRow = async (row: PresetRow) => {
    // Cancel any pending writes for this row
    const t = writeTimers.current.get(row.id);
    if (t) { clearTimeout(t); writeTimers.current.delete(row.id); }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (row.dbId) {
      const { error } = await supabase
        .from("measurement_size_presets" as any)
        .delete()
        .eq("id", row.dbId);
      if (error) toast.error(error.message);
    }
  };

  if (groupId.startsWith("tmp-")) {
    return <p className="text-xs text-muted-foreground italic">Save the group first to add size presets.</p>;
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading presets…</p>;

  if (fieldNames.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Add fields to this group first.</p>;
  }

  const usedLabels = new Set(rows.map((r) => r.size_label.toLowerCase()));
  const availableQuickLabels = DEFAULT_SIZE_LABELS.filter((l) => !usedLabels.has(l.toLowerCase()));
  const anySaving = savingIds.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5">
          <Ruler className="h-3.5 w-3.5" /> Size Presets {unit ? `(${unit})` : ""}
        </Label>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          {anySaving ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
          ) : (
            <><Check className="h-3 w-3 text-success" /> Auto-saved</>
          )}
        </span>
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          No size presets. {productId ? "These override the group defaults for this product." : "Define standard measurements for sizes like S, M, L, XL."}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-md border border-border bg-background p-2 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={r.size_label}
                onChange={(e) => updateLabel(r.id, e.target.value)}
                placeholder="Size label (e.g. L)"
                className="h-8 text-xs font-semibold w-32"
              />
              {savingIds.has(r.id) && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              <Button variant="ghost" size="icon" onClick={() => removeRow(r)} className="h-7 w-7 text-destructive ml-auto" aria-label="Remove size">
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
                      onChange={(e) => updateValue(r.id, fname, e.target.value)}
                      placeholder={groupHint ? `default: ${groupHint}` : ""}
                      className="h-7 text-xs"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
