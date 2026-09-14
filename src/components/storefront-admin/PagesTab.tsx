import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/ConfirmDialog";
import { toast } from "@/hooks/use-toast";
import {
  ChevronDown, ChevronUp, Copy, ExternalLink, Eye, EyeOff, Loader2, Plus, Save, Trash2,
} from "lucide-react";
import type { Storefront } from "./shared";
import { registry, DEFERRED_SECTION_TYPES, type FieldDef, type SectionProps } from "@/storefront/sections/registry";

interface PageRow {
  id: string;
  storefront_id: string;
  slug: string;
  title: string;
  body_md: string | null;
  is_active: boolean;
  type: "home" | "custom";
  status: "draft" | "published";
  seo: { title?: string; description?: string; og_image_url?: string } | null;
  published_at: string | null;
  updated_at: string;
}

interface SectionRow {
  id: string;
  page_id: string;
  type: string;
  position: number;
  is_visible: boolean;
  props: SectionProps;
  updated_at: string;
}

/**
 * Pages tab (Phase 1 builder): page list, section editor with the generic
 * prop form, per-page SEO, nav editor, publish with live preview, and
 * clobber detection (M12) on every save via the updated_at base predicate.
 */
export default function PagesTab({ sf }: { sf: Storefront }) {
  return (
    <div className="space-y-8">
      <NavEditor sf={sf} />
      <PagesSection sf={sf} />
    </div>
  );
}

/** Guarded update: matches the row's current updated_at (M12 clobber detection). */
async function guardedUpdate(
  table: "storefront_pages" | "storefront_page_sections",
  id: string,
  baseUpdatedAt: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; conflict: boolean }> {
  const { data, error } = await supabase
    .from(table)
    .update(patch as never)
    .eq("id", id as never)
    .eq("updated_at", baseUpdatedAt)
    .select();
  if (error) {
    toast({ title: "Save failed", description: error.message, variant: "destructive" });
    return { ok: false, conflict: false };
  }
  if (!data || data.length === 0) {
    return { ok: false, conflict: true };
  }
  return { ok: true, conflict: false };
}

function onConflict() {
  toast({
    title: "This page changed while you were editing",
    description: "Your save was discarded to avoid overwriting newer edits. Reloading the latest version…",
    variant: "destructive",
  });
}

/** Nav editor: label + href rows saved into storefronts.nav. */
function NavEditor({ sf }: { sf: Storefront }) {
  const [rows, setRows] = useState<{ label: string; href: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nav = Array.isArray(sf.nav) ? sf.nav : [];
    setRows(nav.map((n) => ({ label: n.label || "", href: n.href || "" })));
  }, [sf]);

  async function save(next: { label: string; href: string }[]) {
    const cleaned = next.filter((r) => r.label.trim() && r.href.trim());
    setSaving(true);
    const { error } = await supabase.from("storefronts").update({ nav: cleaned }).eq("id", sf.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Navigation saved" });
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium">Navigation</h3>
        <p className="text-xs text-muted-foreground">
          Header/footer links. Leave empty to use the default (Shop, About, Track, Contact). Hrefs are
          relative to the storefront ("/shop", "/pages/size-guide") or absolute URLs.
        </p>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            className="max-w-[180px]"
            placeholder="Label"
            value={row.label}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <Input
            placeholder="/shop"
            value={row.href}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))}
          />
          <Button size="icon" variant="ghost" aria-label="Remove nav item" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setRows((r) => [...r, { label: "", href: "" }])}>
          <Plus className="h-3 w-3" /> Add item
        </Button>
        <Button size="sm" onClick={() => save(rows)} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save navigation
        </Button>
      </div>
    </div>
  );
}

const DEFERRED = DEFERRED_SECTION_TYPES.map((d) => d.type);

function PagesSection({ sf }: { sf: Storefront }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dupTarget, setDupTarget] = useState<PageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PageRow | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("storefront_pages")
      .select("id,storefront_id,slug,title,body_md,is_active,type,status,seo,published_at,updated_at")
      .eq("storefront_id", sf.id)
      .order("type")
      .order("title");
    const rows = (data as unknown as PageRow[]) || [];
    setPages(rows);
    setSelectedId((cur) => (cur && rows.some((p) => p.id === cur) ? cur : rows[0]?.id ?? null));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sf.id]);

  const selected = pages.find((p) => p.id === selectedId) || null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Pages</h3>
          <p className="text-xs text-muted-foreground">
            Draft, preview, then publish. Visitors see the previous version until you publish.
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3" /> New page
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {pages.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 p-3 ${p.id === selectedId ? "bg-muted/40" : ""}`}>
              <button className="flex-1 text-left min-w-0" onClick={() => setSelectedId(p.id)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.title}</span>
                  {p.type === "home" && <Badge variant="outline">Home</Badge>}
                  <Badge variant={p.status === "published" ? "default" : "secondary"}>{p.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">/{p.slug}</div>
              </button>
              <Button
                size="icon"
                variant="ghost"
                title="Open draft preview"
                onClick={() => window.open(`/storefronts/preview/${sf.slug}/${p.slug}`, "_blank")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Duplicate page" onClick={() => setDupTarget(p)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" title="Delete page" className="text-destructive" onClick={() => setDeleteTarget(p)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {pages.length === 0 && <div className="p-4 text-sm text-muted-foreground">No pages yet.</div>}
        </div>
      )}

      {selected && <PageEditor key={selected.id} page={selected} sf={sf} onChanged={load} />}

      <CreatePageDialog
        sf={sf}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          load();
          setSelectedId(id);
        }}
      />
      <DuplicatePageDialog
        sf={sf}
        page={dupTarget}
        onClose={() => setDupTarget(null)}
        onDone={(id) => {
          load();
          setSelectedId(id);
        }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.title ?? ""}”?`}
        description="The page and all its sections are removed. A published page disappears from the storefront immediately."
        confirmLabel="Delete page"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await supabase.from("storefront_pages").delete().eq("id", deleteTarget.id);
          setDeleteTarget(null);
          toast({ title: "Page deleted" });
          load();
        }}
      />
    </div>
  );
}

/** Generic prop form rendered from the registry's declarative adminFields. */
function PropForm({
  fields,
  value,
  onChange,
}: {
  fields: FieldDef[];
  value: SectionProps;
  onChange: (next: SectionProps) => void;
}) {
  const set = (key: string, v: any) => onChange({ ...value, [key]: v });

  function StringsList({ field }: { field: FieldDef }) {
    const list: string[] = Array.isArray(value[field.key]) ? value[field.key] : [];
    return (
      <div className="space-y-2">
        {list.map((item, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => set(field.key, list.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={field.placeholder}
            />
            <Button size="icon" variant="ghost" aria-label="Remove item" onClick={() => set(field.key, list.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="gap-1" onClick={() => set(field.key, [...list, ""])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
    );
  }

  function ListOfObjects({ field }: { field: FieldDef }) {
    const list: any[] = Array.isArray(value[field.key]) ? value[field.key] : [];
    const itemFields = field.itemFields || [];
    const labelOf = (entry: any) =>
      (field.itemLabelKey && entry?.[field.itemLabelKey]) || Object.values(entry || {})[0] || "(empty)";
    return (
      <div className="space-y-3">
        {list.map((entry, i) => (
          <div key={i} className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium truncate">{String(labelOf(entry))}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove entry"
                onClick={() => set(field.key, list.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {itemFields.map((sub) => (
              <div key={sub.key}>
                <Label className="text-xs">{sub.label}</Label>
                {sub.type === "textarea" ? (
                  <Textarea
                    rows={2}
                    value={entry?.[sub.key] || ""}
                    onChange={(e) =>
                      set(
                        field.key,
                        list.map((x, j) => (j === i ? { ...x, [sub.key]: e.target.value } : x)),
                      )
                    }
                  />
                ) : (
                  <Input
                    value={entry?.[sub.key] || ""}
                    placeholder={sub.placeholder}
                    onChange={(e) =>
                      set(
                        field.key,
                        list.map((x, j) => (j === i ? { ...x, [sub.key]: e.target.value } : x)),
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={() => set(field.key, [...list, Object.fromEntries(itemFields.map((f) => [f.key, ""]))])}
        >
          <Plus className="h-3 w-3" /> Add entry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.key}>
          <Label className="text-xs">{field.label}</Label>
          {field.type === "textarea" && (
            <Textarea rows={4} value={value[field.key] || ""} onChange={(e) => set(field.key, e.target.value)} />
          )}
          {(field.type === "text" || field.type === "image-url") && (
            <Input value={value[field.key] || ""} placeholder={field.placeholder} onChange={(e) => set(field.key, e.target.value)} />
          )}
          {field.type === "number" && (
            <Input
              type="number"
              value={value[field.key] ?? ""}
              min={field.min}
              max={field.max}
              onChange={(e) => set(field.key, e.target.value === "" ? "" : Number(e.target.value))}
            />
          )}
          {field.type === "toggle" && (
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!value[field.key]} onChange={(e) => set(field.key, e.target.checked)} />
              Enabled
            </label>
          )}
          {field.type === "select" && (
            <select
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
              value={String(value[field.key] ?? "")}
              onChange={(e) => set(field.key, e.target.value)}
            >
              {(field.options || []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {field.type === "strings-list" && <StringsList field={field} />}
          {field.type === "list-of-objects" && <ListOfObjects field={field} />}
          {field.help && <p className="text-xs text-muted-foreground mt-1">{field.help}</p>}
        </div>
      ))}
    </div>
  );
}

/** The per-page editor: meta + SEO, ordered sections, publish + preview. */
function PageEditor({ page, sf, onChanged }: { page: PageRow; sf: Storefront; onChanged: () => void }) {
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addType, setAddType] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState(page.title);
  const [seo, setSeo] = useState<{ title?: string; description?: string; og_image_url?: string }>(page.seo || {});
  const [publishing, setPublishing] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("storefront_page_sections")
      .select("id,page_id,type,position,is_visible,props,updated_at")
      .eq("page_id", page.id)
      .order("position");
    setSections((data as unknown as SectionRow[]) || []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);
  useEffect(() => {
    setTitle(page.title);
    setSeo(page.seo || {});
  }, [page]);

  /** Section/page saves are last-write-wins AFTER a detected conflict (M12):
   *  every save sends the row's updated_at it was based on and matches
   *  WHERE id = ? AND updated_at = <base> — zero rows → conflict toast. */
  async function saveSection(sec: SectionRow, patch: Partial<SectionRow> & { props?: SectionProps }) {
    const res = await guardedUpdate("storefront_page_sections", sec.id, sec.updated_at, patch);
    if (res.conflict) {
      onConflict();
      load();
      return;
    }
    load();
  }

  async function addSection() {
    if (!addType || !registry[addType]) return;
    const nextPos = sections.length ? Math.max(...sections.map((s) => s.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("storefront_page_sections")
      .insert({ page_id: page.id, type: addType, position: nextPos, is_visible: true, props: registry[addType].defaultProps })
      .select()
      .single();
    if (error) {
      toast({ title: "Could not add section", description: error.message, variant: "destructive" });
      return;
    }
    setAddType("");
    setEditingId((data as any).id);
    load();
  }

  async function moveSection(sec: SectionRow, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === sec.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const r1 = await guardedUpdate("storefront_page_sections", sec.id, sec.updated_at, { position: swap.position });
    if (r1.conflict) {
      onConflict();
      load();
      return;
    }
    const r2 = await guardedUpdate("storefront_page_sections", swap.id, swap.updated_at, { position: sec.position });
    if (r2.conflict) {
      onConflict();
      load();
      return;
    }
    load();
  }

  async function removeSection(sec: SectionRow) {
    await supabase.from("storefront_page_sections").delete().eq("id", sec.id);
    load();
  }

  async function savePageMeta() {
    const res = await guardedUpdate("storefront_pages", page.id, page.updated_at, {
      title,
      seo: { ...(page.seo || {}), ...seo },
    });
    if (res.conflict) {
      onConflict();
      onChanged();
      return;
    }
    toast({ title: "Page saved" });
    onChanged();
  }

  /** Publish = copy visible sorted sections into published_snapshot + stamp. */
  async function publish(unpublish = false) {
    setPublishing(true);
    const patch: Record<string, unknown> = unpublish
      ? { status: "draft" }
      : {
          status: "published",
          published_at: new Date().toISOString(),
          published_snapshot: [...sections]
            .filter((s) => s.is_visible)
            .sort((a, b) => a.position - b.position)
            .map((s) => ({ type: s.type, position: s.position, is_visible: true, props: s.props })),
        };
    const res = await guardedUpdate("storefront_pages", page.id, page.updated_at, patch);
    setPublishing(false);
    if (res.conflict) {
      onConflict();
      onChanged();
      return;
    }
    toast({ title: unpublish ? "Page unpublished — visitors see the legacy layout" : "Page published" });
    onChanged();
  }

  const sorted = [...sections].sort((a, b) => a.position - b.position);

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Page title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="text-xs text-muted-foreground pb-2">
          /{page.slug} · {page.status}
        </div>
        <Button onClick={savePageMeta} variant="outline" size="sm" className="gap-1">
          <Save className="h-3 w-3" /> Save title &amp; SEO
        </Button>
        {page.status === "published" ? (
          <Button onClick={() => publish(true)} variant="outline" size="sm" disabled={publishing}>
            Unpublish
          </Button>
        ) : (
          <Button onClick={() => publish(false)} size="sm" disabled={publishing || loading} className="gap-1">
            {publishing && <Loader2 className="h-3 w-3 animate-spin" />} Publish
          </Button>
        )}
      </div>

      {/* Per-page SEO (stored now; wired into the storefront meta by the SEO phase) */}
      <details className="rounded border border-border p-3">
        <summary className="text-xs font-medium cursor-pointer">SEO (meta title, description, OG image)</summary>
        <div className="grid gap-3 pt-3">
          <div>
            <Label className="text-xs">Meta title</Label>
            <Input value={seo.title || ""} onChange={(e) => setSeo({ ...seo, title: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Meta description</Label>
            <Textarea rows={2} value={seo.description || ""} onChange={(e) => setSeo({ ...seo, description: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">OG image URL</Label>
            <Input value={seo.og_image_url || ""} onChange={(e) => setSeo({ ...seo, og_image_url: e.target.value })} />
          </div>
        </div>
      </details>

      {/* Live preview iframe (draft mode) */}
      <div>
        <Label className="text-xs">Live preview (draft)</Label>
        <iframe
          title={`Preview of ${page.title}`}
          src={`/storefronts/preview/${sf.slug}/${page.slug}`}
          className="w-full h-[420px] mt-2 rounded-lg border border-border bg-background"
        />
      </div>

      {/* Sections */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Sections</h4>
          <div className="flex gap-2 items-center">
            <Select value={addType} onValueChange={setAddType}>
              <SelectTrigger className="w-[190px] h-9">
                <SelectValue placeholder="Add a section…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(registry).map(([type, def]) => (
                  <SelectItem key={type} value={type}>
                    {def.adminLabel}
                  </SelectItem>
                ))}
                {DEFERRED.map((t) => (
                  <SelectItem key={t} value={t} disabled>
                    {t} (deferred)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={addSection} disabled={!addType} className="gap-1">
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sections yet — add one above.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((sec) => {
              const def = registry[sec.type];
              const errors = def ? def.validate({ ...def.defaultProps, ...sec.props }) : [];
              return (
                <div key={sec.id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 p-2">
                    <span className="text-sm font-medium flex-1">{def?.adminLabel || sec.type}</span>
                    {!def && <Badge variant="destructive">unknown type</Badge>}
                    {errors.length > 0 && <Badge variant="secondary">needs setup</Badge>}
                    <Button
                      size="icon"
                      variant="ghost"
                      title={sec.is_visible ? "Hide section" : "Show section"}
                      onClick={() => saveSection(sec, { is_visible: !sec.is_visible })}
                    >
                      {sec.is_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" title="Move up" onClick={() => moveSection(sec, -1)}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Move down" onClick={() => moveSection(sec, 1)}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete section" className="text-destructive" onClick={() => removeSection(sec)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(editingId === sec.id ? null : sec.id)}>
                      {editingId === sec.id ? "Close" : "Edit"}
                    </Button>
                  </div>
                  {editingId === sec.id && def && (
                    <div className="border-t border-border p-3">
                      <PropForm
                        fields={def.adminFields}
                        value={{ ...def.defaultProps, ...sec.props }}
                        onChange={(props) => saveSection(sec, { props })}
                      />
                      <p className="text-xs text-muted-foreground mt-2">Changes save automatically.</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CreatePageDialog({
  sf,
  open,
  onOpenChange,
  onCreated,
}: {
  sf: Storefront;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<"home" | "custom">("custom");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setSlug("");
      setType("custom");
    }
  }, [open]);

  function handleTitle(v: string) {
    setTitle(v);
    if (!slug || slug === title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) {
      setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    }
  }

  async function create() {
    if (!title.trim() || !slug.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("storefront_pages")
      .insert({
        storefront_id: sf.id,
        slug: slug.trim(),
        title: title.trim(),
        type,
        status: "draft",
        is_active: true,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Could not create page", description: error.message, variant: "destructive" });
      return;
    }
    onOpenChange(false);
    toast({ title: "Page created", description: "Add sections, then publish." });
    onCreated((data as any).id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>Creates a draft. Nothing is visible on the storefront until published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => handleTitle(e.target.value)} placeholder="Size guide" />
          </div>
          <div>
            <Label className="text-xs">Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="size-guide"
            />
            <p className="text-xs text-muted-foreground mt-1">Serves at /pages/{slug || "…"}</p>
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "home" | "custom")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom page</SelectItem>
                <SelectItem value="home">Homepage</SelectItem>
              </SelectContent>
            </Select>
            {type === "home" && (
              <p className="text-xs text-muted-foreground mt-1">Only one homepage per storefront is allowed.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={create} disabled={saving || !title.trim() || !slug.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicatePageDialog({
  sf,
  page,
  onClose,
  onDone,
}: {
  sf: Storefront;
  page: PageRow | null;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (page) {
      setTitle(`${page.title} copy`);
      setSlug(`${page.slug}-copy`);
    }
  }, [page]);

  async function duplicate() {
    if (!page) return;
    setSaving(true);
    // Copy the page row (the copy always starts as a draft)
    const { data: newPage, error } = await supabase
      .from("storefront_pages")
      .insert({
        storefront_id: sf.id,
        slug: slug.trim(),
        title: title.trim() || `${page.title} copy`,
        body_md: page.body_md,
        type: "custom",
        status: "draft",
        is_active: true,
        seo: page.seo || {},
      })
      .select("id")
      .single();
    if (error || !newPage) {
      setSaving(false);
      toast({ title: "Could not duplicate page", description: error?.message, variant: "destructive" });
      return;
    }
    const newId = (newPage as any).id as string;
    const { data: secs } = await supabase
      .from("storefront_page_sections")
      .select("type,position,is_visible,props")
      .eq("page_id", page.id)
      .order("position");
    if (secs?.length) {
      await supabase.from("storefront_page_sections").insert(
        secs.map((s: any) => ({
          page_id: newId,
          type: s.type,
          position: s.position,
          is_visible: s.is_visible,
          props: s.props,
        })),
      );
    }
    setSaving(false);
    onClose();
    toast({ title: "Page duplicated", description: "The copy is a draft." });
    onDone(newId);
  }

  return (
    <Dialog open={!!page} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Duplicate “{page?.title}”</DialogTitle>
          <DialogDescription>The copy starts as a draft with all sections copied.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={duplicate} disabled={saving || !slug.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}










