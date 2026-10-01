import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget, TurnstileWidgetRef } from "@/components/TurnstileWidget";
import { generateStoreSlug } from "@/lib/slug";
import { toast } from "sonner";
import { Building2, Loader2, Store, Plus } from "lucide-react";

interface CreateBusinessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBusinessDialog({ open, onOpenChange }: CreateBusinessDialogProps) {
  const { refresh, setActive } = useBusinessContext();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);

  const slug = generateStoreSlug(name || "new-store");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      toast.error("Business name must be between 1 and 100 characters");
      return;
    }

    setLoading(true);

    try {
      const captchaToken = turnstileRef.current?.getToken() || undefined;

      const { data, error } = await supabase.functions.invoke("create-business", {
        body: {
          business_name: trimmed,
          captchaToken,
        },
      });

      setLoading(false);

      if (error || !data?.business_id) {
        turnstileRef.current?.reset();
        const msg = error?.message || data?.message || "Failed to create business";
        toast.error(msg);
        return;
      }

      toast.success(`Business "${trimmed}" created successfully!`);
      setName("");
      onOpenChange(false);

      // Refresh business list and switch to newly created business
      await refresh();
      setActive(data.business_id);
    } catch (err: any) {
      setLoading(false);
      turnstileRef.current?.reset();
      toast.error(err?.message || "An unexpected error occurred");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" /> Create New Business
            </DialogTitle>
            <DialogDescription className="text-xs">
              Provision a complete new business entity with default showroom, warehouse, online storefront, and POS.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="createBizName">Business Name</Label>
              <Input
                id="createBizName"
                placeholder="e.g. Apex Sportswear"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
                autoFocus
              />
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 p-2 rounded border border-border/30">
                <Store className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">
                  Storefront URL: <strong className="text-foreground">https://{slug}.stores.dokanos.app</strong>
                </span>
              </div>
            </div>

            <TurnstileWidget ref={turnstileRef} action="create_business" />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-1.5">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" /> Create Business
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
