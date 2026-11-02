import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, RotateCcw, Play } from "lucide-react";
import type { Storefront } from "./shared";
import { mergeSettings, DEFAULT_ANIMATIONS, type StorefrontAnimationSettings } from "@/storefront/lib/settings";

const EFFECTS: { value: StorefrontAnimationSettings["effect"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade In" },
  { value: "rise", label: "Rise Up" },
  { value: "drop", label: "Drop Down" },
  { value: "slide-l", label: "Slide From Left" },
  { value: "slide-r", label: "Slide From Right" },
  { value: "zoom-in", label: "Zoom In" },
  { value: "zoom-out", label: "Zoom Out" },
  { value: "blur", label: "Blur In" },
  { value: "flip", label: "Flip Up" },
  { value: "tilt", label: "Tilt In" },
  // curtain & bounce
  { value: "bounce", label: "Bounce Up" },
];

function PreviewTile({ label, effect, speedMs, active, onClick }: { label: string; effect: StorefrontAnimationSettings["effect"]; speedMs: number; active: boolean; onClick: () => void }) {
  const KEY = `${effect}-${speedMs}-${Date.now()}`;
  return (
    <button type="button" onClick={onClick} className={`group relative rounded-md border p-3 text-left transition-colors ${
      active ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50 bg-card"
    }`}>
      <div className="h-12 overflow-hidden mb-2 relative">
        <div
          key={KEY}
          className="demo-card"
          style={{ animationName: `pre-${effect}`, animationDuration: `${speedMs}ms`, animationFillMode: "both" }}
        />
      </div>
      <p className="text-xs font-medium text-foreground">{label}</p>
    </button>
  );
}

export default function AnimationsTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [a, setA] = useState<StorefrontAnimationSettings>(() => mergeSettings((sf as any).settings).animations);
  const [previewTick, setPreviewTick] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setA(mergeSettings((sf as any).settings).animations);
  }, [sf]);

  async function save() {
    setSaving(true);
    const settings = { ...mergeSettings((sf as any).settings), animations: a };
    const { data, error } = await supabase.from("storefronts").update({ settings: settings as any }).eq("id", sf.id).select().single();
    setSaving(false);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    onUpdate(data as any);
    toast({ title: "Animations saved" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Animate my storefront</h3>
              <p className="text-xs text-muted-foreground mt-0.5">One entrance effect applies to every section as customers scroll. Never runs on cart, checkout, order-success, or track-order.</p>
            </div>
            <Switch checked={a.enabled} onCheckedChange={(v) => setA({ ...a, enabled: v })} />
          </div>
        </CardContent>
      </Card>

      {a.enabled && (
        <>
          <Card>
              <CardContent className="pt-6 space-y-3">
              <h3 className="text-sm font-medium">Effect</h3>
              <p className="text-xs text-muted-foreground">Click a tile to select it and replay the preview.</p>
              <style>{`
                .anim-preview [data-effect][data-replay-key] { animation: var(--anim-duration, 700ms) both; }
                .anim-preview .demo-card {
                  background: hsl(var(--muted)); height: 3.5rem; border-radius: 0.375rem;
                  transition: opacity var(--anim-duration) cubic-bezier(0.22,1,0.36,1), transform var(--anim-duration) cubic-bezier(0.22,1,0.36,1), filter var(--anim-duration) cubic-bezier(0.22,1,0.36,1);
                }
                .anim-preview .demo-card:not(.played) { opacity: 0; }
                @keyframes pre-fade { to { opacity: 1; filter: blur(0); } }
                @keyframes pre-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
                @keyframes pre-drop { from { opacity: 0; transform: translateY(-24px); } to { opacity: 1; transform: none; } }
                @keyframes pre-slide-l { from { opacity: 0; transform: translateX(-36px); } to { opacity: 1; transform: none; } }
                @keyframes pre-slide-r { from { opacity: 0; transform: translateX(36px); } to { opacity: 1; transform: none; } }
                @keyframes pre-zoom-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
                @keyframes pre-zoom-out { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: none; } }
                @keyframes pre-blur { from { opacity: 0; filter: blur(14px); } to { opacity: 1; filter: none; } }
                @keyframes pre-flip { from { opacity: 0; transform: rotateX(12deg) translateY(16px); } to { opacity: 1; transform: none; } }
                @keyframes pre-tilt { from { opacity: 0; transform: rotate(-2deg) translateY(24px); } to { opacity: 1; transform: none; } }
                @keyframes pre-bounce { from { opacity: 0; transform: translateY(30px) scale(.98); } 40% { transform: translateY(-4px); opacity: 1; } to { opacity: 1; transform: none; } }
              `}</style>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 anim-preview" style={{ ["--anim-duration" as any]: `${a.speed_ms}ms` }}>
                {EFFECTS.map((e) => {
                  const isActive = a.effect === e.value;
                  return (
                    <PreviewTile
                      key={e.value + previewTick}
                      label={e.label}
                      effect={e.value}
                      speedMs={a.speed_ms}
                      active={isActive}
                      onClick={() => { setA({ ...a, effect: e.value }); setPreviewTick((t) => t + 1); }}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <h3 className="text-sm font-medium">Timing</h3>
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">SPEED</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">{a.speed_ms}ms</span>
                  </div>
                  <Slider value={[a.speed_ms]} min={200} max={1600} step={100} onValueChange={([v]) => setA({ ...a, speed_ms: v })} />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1"><span>Faster</span><span>Slower</span></div>
                </div>
                <div>
                  <Label className="text-xs mb-2 block">STRENGTH</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["subtle", "medium", "strong"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setA({ ...a, strength: s })}
                        className={`border rounded px-2 py-1.5 text-xs capitalize transition ${a.strength === s ? "border-primary bg-primary/5 text-primary" : "border-border"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">Cascade product cards</Label>
                  <Switch checked={a.cascade} onCheckedChange={(v) => setA({ ...a, cascade: v })} />
                </div>
                {a.cascade && (
                  <div className="pt-1">
                    <Label className="text-xs">Gap between cards — {a.cascade_gap_ms}ms</Label>
                    <Slider value={[a.cascade_gap_ms]} min={0} max={300} step={10} onValueChange={([v]) => setA({ ...a, cascade_gap_ms: v })} />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-2">
              <h3 className="text-sm font-medium">Behaviour</h3>
              <div className="flex items-center justify-between py-1.5">
                <div className="pr-4">
                  <Label className="text-sm">Play only once per page</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Off = section animates again every time it scrolls into view.</p>
                </div>
                <Switch checked={a.play_once} onCheckedChange={(v) => setA({ ...a, play_once: v })} />
              </div>
              <div className="flex items-center justify-between py-1.5">
                <div className="pr-4">
                  <Label className="text-sm">Animate on page load</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Off = top of the page starts still.</p>
                </div>
                <Switch checked={a.animate_on_load} onCheckedChange={(v) => setA({ ...a, animate_on_load: v })} />
              </div>
              <div className="flex items-center justify-between py-1.5">
                <div className="pr-4">
                  <Label className="text-sm">Animate on phones</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Off keeps low-end devices completely still. Visitors whose system is set to reduce motion always see the store still.</p>
                </div>
                <Switch checked={a.animate_on_phones} onCheckedChange={(v) => setA({ ...a, animate_on_phones: v })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Preview</h3>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setPreviewTick((t) => t + 1)}>
                  <Play className="h-3 w-3" /> Replay
                </Button>
              </div>
              <div className="border border-border rounded-md p-6 space-y-3 bg-muted/30 anim-preview" style={{ ["--anim-duration" as any]: `${a.speed_ms}ms` }}>
                <div
                  key={previewTick}
                  className="demo-card h-20 rounded-md border border-border bg-background flex items-center justify-center text-sm"
                  style={{ animationName: `pre-${a.effect}`, animationDuration: `${a.speed_ms}ms`, animationFillMode: "both" }}
                >
                  A section of your store.
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Animation never runs on /cart, /checkout, /order-success, /track-order.</p>
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
        <Button variant="outline" onClick={() => setA(DEFAULT_ANIMATIONS)} className="gap-2">
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </div>
    </div>
  );
}
