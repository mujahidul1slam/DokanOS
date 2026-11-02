import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Globe, Loader2, Plus, Trash2 } from "lucide-react";
import type { Storefront } from "./shared";

/** Custom domains tab (refactor of the old DomainsEditor — no behavior change). */
export default function DomainsTab({ sf, onUpdate }: { sf: Storefront; onUpdate: (s: Storefront) => void }) {
  const [domains, setDomains] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Keep the local list in sync when the storefront record changes
  useEffect(() => {
    const cd = (sf.social || {}) as Record<string, unknown>;
    setDomains(Array.isArray(cd.custom_domains) ? (cd.custom_domains as string[]) : []);
  }, [sf]);

  /** Accept full URLs, www-prefixed hosts, or bare hostnames → canonical host. */
  function normalize(raw: string): string | null {
    const v = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(v) ? v : null;
  }

  async function save(next: string[]) {
    setSaving(true);
    const social = { ...((sf.social || {}) as Record<string, unknown>), custom_domains: next };
    const { data, error } = await supabase
      .from("storefronts")
      .update({ social })
      .eq("id", sf.id)
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast({ title: "Failed to update domains", description: error.message, variant: "destructive" });
      return;
    }
    // Parent onUpdate also invalidates the slug cache so detection picks this up
    onUpdate(data as unknown as Storefront);
    toast({ title: "Domains updated" });
  }

  function add() {
    const v = normalize(input);
    if (!v) {
      toast({ title: "Invalid domain", description: "Use a hostname like shop.example.com", variant: "destructive" });
      return;
    }
    if (domains.includes(v)) {
      toast({ title: "Already added" });
      return;
    }
    const next = [...domains, v];
    setDomains(next);
    setInput("");
    save(next);
  }

  function remove(d: string) {
    const next = domains.filter((x) => x !== d);
    setDomains(next);
    save(next);
  }

  return (
    <Card className="border-dashed">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start gap-3">
          <Globe className="h-5 w-5 mt-1 text-muted-foreground" />
          <div className="flex-1">
            <h3 className="text-sm font-medium">Custom domains</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Visitors on these hosts automatically see this storefront. Matching is exact
              (including <code>www.</code>), so add both forms if you use both.
            </p>

            {domains.length === 0 ? (
              <p className="text-sm text-muted-foreground mb-3">
                No custom domains yet — this storefront is reachable at{" "}
                <code>/storefront/{sf.slug}</code> and via subdomain matching.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-3">
                {domains.map((d) => (
                  <Badge key={d} variant="secondary" className="gap-1 pr-1">
                    {d}
                    <button
                      onClick={() => remove(d)}
                      disabled={saving}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                      aria-label={`Remove ${d}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex gap-2 max-w-md">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="shop.example.com"
                disabled={saving}
              />
              <Button size="sm" onClick={add} disabled={saving || !input.trim()} className="gap-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-foreground text-sm mb-1">DNS setup</div>
          <p>
            1. Create a <code>CNAME</code> record pointing your domain (or subdomain) to{" "}
            <code>dokanos.vercel.app</code>. For apex domains use an ALIAS/ANAME record if your
            provider supports it.
          </p>
          <p>2. Add the same domain in your hosting provider (Vercel → Project → Domains) so SSL is provisioned.</p>
          <p>3. DNS changes can take up to 24–48 hours to propagate.</p>
        </div>
      </CardContent>
    </Card>
  );
}
