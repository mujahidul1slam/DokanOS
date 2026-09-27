import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink, GripVertical, LayoutTemplate,
  Loader2, MousePointerClick, Plus, Save, Sparkles, Trash2, X,
} from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";
import { registry, type FieldDef, type SectionProps } from "@/storefront/sections/registry";

/**
 * Visual page builder (overhaul 3.2 / fix E): a real two-pane editor.
 *
 *   LEFT  — element drawer: draggable registry blocks + section list +
 *           inspector for the selected section.
 *   RIGHT — full-pane interactive canvas: the DRAFT page rendered via the
 *           postMessage pipeline; dropping a drawer card adds that section.
 *
 * Route: /storefronts/:slug/admin/pages/:pageId/edit (Edit on a content page).
 */

interface SectionRow {
  id: string;
  page_id: string;
  type: string;
  position: number;
  is_visible: boolean;
  props: SectionProps;
  updated_at: string;
}

interface PageRow {
  id: string; slug: string; title: string; type: string; status: string;
}

export default function VisualPageBuilder() {
  const { slug, pageId } = useParams();
  const navigate = useNavigate();
  const [sf, setSf] = useState<Storefront | null | undefined>(undefined);
  const [page, setPage] = useState<PageRow | null | undefined>(undefined);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [selected, setSelected] = useState<SectionRow | null>(null);
  const [dragType, setDragType] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: sfRow } = await supabase.from("storefronts").select("*").eq("slug", slug).maybeSingle();
      if (!alive) return;
      setSf((sfRow as unknown as Storefront) || null);
      if (sfRow && pageId) {
        const { data: pageRow } = await supabase.from("storefront_pages").select("id,slug,title,type,status").eq("id", pageId).maybeSingle();
        if (!alive) return;
        setPage((pageRow as unknown as PageRow) || null);
        await loadSections(pageId);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [slug, pageId]);

  async function loadSections(pid: string) {
    const { data } = await supabase
      .from("storefront_page_sections")
      .select("id,page_id,type,position,is_visible,props,updated_at")
      .eq("page_id", pid)
      .order("position");
    setSections((data as unknown as SectionRow[]) || []);
  }

  async function insertSection(type: string, atPos?: number) {
    if (!page || !registry[type]) return;
    const pos = atPos ?? (sections.length ? Math.max(...sections.map((s) => s.position)) + 1 : 0);
    const { data, error } = await supabase
      .from("storefront_page_sections")
      .insert({ page_id: page.id, type, position: pos, is_visible: true, props: registry[type].defaultProps })
      .select()
      .single();
    if (error) { toast({ title: "Could not add section", description: error.message, variant: "destructive" }); return; }
    await loadSections(page.id);
    setSelected((data as unknown as SectionRow));
    setPreviewKey((k) => k + 1);
    toast({ title: `${registry[type].adminLabel} added` });
  }

  async function renumber(order: SectionRow[]) {
    for (let i = 0; i < order.length; i++) {
      if (order[i].position !== i) {
        await supabase.from("storefront_page_sections").update({ position: i } as never).eq("id", order[i].id as never);
      }
    }
    await loadSections(page!.id);
    setPreviewKey((k) => k + 1);
  }

  async function moveSection(sec: SectionRow, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === sec.id);
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    next.splice(idx, 1);
    next.splice(target, 0, sec);
    await renumber(next);
  }

  async function toggleVisible(sec: SectionRow) {
    await supabase.from("storefront_page_sections").update({ is_visible: !sec.is_visible } as never).eq("id", sec.id as never);
    await loadSections(page!.id);
    setPreviewKey((k) => k + 1);
  }

  async function removeSection(sec: SectionRow) {
    await supabase.from("storefront_page_sections").delete().eq("id", sec.id);
    setSelected(null);
    await loadSections(page!.id);
    setPreviewKey((k) => k + 1);
  }

  async function saveProps(sec: SectionRow, props: SectionProps) {
    await supabase.from("storefront_page_sections").update({ props: props as never } as never).eq("id", sec.id as never);
    await loadSections(page!.id);
    setPreviewKey((k) => k + 1);
  }

  if (sf === undefined || page === undefined || loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!sf || !page) {
    return <div className="text-center py-20 text-muted-foreground">Page not found.</div>;
  }

  const sorted = [...sections].sort((a, b) => a.position - b.position);
  const previewUrl = `/storefronts/preview/${sf.slug}/home?surface=home&draft=${page.slug}`;

  return (
    <div className="space-y-3">
      {/* Builder header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/storefronts/${sf.slug}/admin/pages`)}>
            ← Pages
          </Button>
          <div>
            <h2 className="text-base font-semibold inline-flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-primary" /> {page.title}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline">/{page.slug}</Badge>
              <Badge variant={page.status === "published" ? "default" : "secondary"}>{page.status}</Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/storefront/${sf.slug}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm" className="gap-2"><ExternalLink className="h-3.5 w-3.5" /> View Store</Button>
          </a>
        </div>
      </div>

      {/* Two-pane builder */}
      <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* LEFT: element drawer + section list + inspector */}
        <div className="space-y-4">
          {/* Draggable element palette */}
          <div className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium mb-2 inline-flex items-center gap-2">
              <MousePointerClick className="h-4 w-4 text-primary" /> Elements
            </h3>
            <p className="text-[11px] text-muted-foreground mb-2">Drag onto the canvas, or click to add.</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(registry).map(([type, def]) => (
                <div
                  key={type}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/sf-block", type);
                    e.dataTransfer.effectAllowed = "copy";
                    setDragType(type);
                  }}
                  onDragEnd={() => setDragType(null)}
                  onClick={() => insertSection(type)}
                  className={`cursor-grab active:cursor-grabbing rounded-md border px-2.5 py-2.5 text-xs font-medium transition select-none ${
                    dragType === type ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <GripVertical className="h-3 w-3 inline-block mr-1 text-muted-foreground" />
                  {def.adminLabel}
                </div>
              ))}
            </div>
          </div>

          {/* Section list (order/visibility/delete) */}
          <div className="rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium mb-2">Sections ({sorted.length})</h3>
            {sorted.length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet — drag an element over.</p>
            ) : (
              <div className="space-y-1.5">
                {sorted.map((sec) => {
                  const def = registry[sec.type];
                  return (
                    <div
                      key={sec.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/sf-reorder", sec.id)}
                      onDragOver={(e) => e.dataTransfer.types.includes("text/sf-reorder") && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData("text/sf-reorder");
                        const fromIdx = sorted.findIndex((s) => s.id === draggedId);
                        const toIdx = sorted.findIndex((s) => s.id === sec.id);
                        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
                        const next = [...sorted];
                        next.splice(fromIdx, 1);
                        next.splice(toIdx, 0, sorted[fromIdx]);
                        renumber(next);
                      }}
                      onClick={() => setSelected(sec)}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing transition ${
                        selected?.id === sec.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                      } ${!sec.is_visible ? "opacity-50" : ""}`}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate font-medium">{def?.adminLabel || sec.type}</span>
                      <button onClick={(e) => { e.stopPropagation(); toggleVisible(sec); }} aria-label="Toggle visibility" className="text-muted-foreground hover:text-foreground">
                        {sec.is_visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); moveSection(sec, -1); }} aria-label="Move up" className="text-muted-foreground hover:text-foreground">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); moveSection(sec, 1); }} aria-label="Move down" className="text-muted-foreground hover:text-foreground">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); removeSection(sec); }} aria-label="Delete" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Inspector */}
          {selected && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">{registry[selected.type]?.adminLabel || selected.type}</h3>
                <button onClick={() => setSelected(null)} aria-label="Close inspector" className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <InspectorForm
                fields={registry[selected.type]?.adminFields || []}
                value={selected.props}
                onSave={(props) => saveProps(selected, props)}
              />
            </div>
          )}
        </div>

        {/* RIGHT: full-pane canvas — the DRAFT page via postMessage pipeline */}
        <div className="rounded-xl border border-border overflow-hidden bg-muted/20 lg:sticky lg:top-24">
          <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-2 text-[10px] text-muted-foreground truncate">Canvas — {page.title} (draft) · {previewUrl}</span>
          </div>
          <iframe
            key={previewKey}
            src={previewUrl}
            title="Page canvas"
            className="w-full h-[calc(100vh-11rem)] min-h-[36rem] border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("text/sf-block")) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const type = e.dataTransfer.getData("text/sf-block");
              if (type) insertSection(type);
            }}
          />
          <p className="text-[11px] text-muted-foreground py-2 text-center border-t border-border bg-card">
            Drop elements anywhere on the canvas — the draft updates on every change.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Inspector form: registry fields → save button (persist + canvas refresh). */
function InspectorForm({ fields, value, onSave }: { fields: FieldDef[]; value: SectionProps; onSave: (props: SectionProps) => void }) {
  const [draft, setDraft] = useState<SectionProps>(() => structuredClone(value || {}));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(structuredClone(value || {}));
  }, [value]);

  const set = (key: string, v: unknown) => setDraft({ ...draft, [key]: v });

  async function save() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.key}>
          <Label className="text-xs">{field.label}</Label>
          {field.type === "textarea" && (
            <textarea rows={3} value={(draft as any)[field.key] || ""} onChange={(e) => set(field.key, e.target.value)}
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
          )}
          {(field.type === "text" || field.type === "image-url") && (
            <Input value={(draft as any)[field.key] || ""} placeholder={field.placeholder} onChange={(e) => set(field.key, e.target.value)} />
          )}
          {field.type === "number" && (
            <Input type="number" value={(draft as any)[field.key] ?? ""} min={field.min} max={field.max}
              onChange={(e) => set(field.key, e.target.value === "" ? "" : Number(e.target.value))} />
          )}
          {field.type === "select" && (
            <select
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
              value={String((draft as any)[field.key] ?? "")}
              onChange={(e) => set(field.key, e.target.value)}
            >
              {(field.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {field.type === "toggle" && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!(draft as any)[field.key]} onChange={(e) => set(field.key, e.target.checked)} /> Enabled
            </label>
          )}
          {field.type === "strings-list" && (
            <div className="space-y-1.5">
              {((Array.isArray((draft as any)[field.key]) ? (draft as any)[field.key] : []) as string[]).map((item, i, list) => (
                <div key={i} className="flex gap-1.5">
                  <Input value={item} onChange={(e) => set(field.key, list.map((x, j) => (j === i ? e.target.value : x)))} />
                  <Button size="icon" variant="ghost" onClick={() => set(field.key, list.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="gap-1" onClick={() => set(field.key, [...((draft as any)[field.key] || []), ""])}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          )}
          {field.help && <p className="text-[11px] text-muted-foreground mt-1">{field.help}</p>}
        </div>
      ))}
      <Button onClick={save} disabled={saving} size="sm" className="gap-2 w-full">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Apply to section
      </Button>
    </div>
  );
}
