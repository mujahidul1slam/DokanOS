import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Store,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  Globe,
  Sparkles,
  Loader2,
  Lock,
} from "lucide-react";
import dokanosLogo from "@/assets/dokanos-logo-stacked.png";

export default function Welcome() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const slugParam = searchParams.get("slug") || "";

  const [businessName, setBusinessName] = useState("Your Business");
  const [storeSlug, setStoreSlug] = useState(slugParam);
  const [isPublished, setIsPublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBusinessData() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate("/login");
          return;
        }

        // Fetch user's business from get_my_businesses RPC
        const { data: businesses } = await supabase.rpc("get_my_businesses");
        if (businesses && businesses.length > 0) {
          const myBiz = businesses[0];
          setBusinessName(myBiz.name);
          if (!storeSlug) setStoreSlug(myBiz.slug);
        }

        // Check if storefront is already published
        const { data: sf } = await supabase
          .from("storefronts")
          .select("is_active, slug")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (sf) {
          setIsPublished(sf.is_active || false);
          if (sf.slug) setStoreSlug(sf.slug);
        }

        setLoading(false);
      } catch (e) {
        console.warn("Failed to load welcome info:", e);
        setLoading(false);
      }
    }

    loadBusinessData();
  }, [navigate, storeSlug]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      const { data, error } = await supabase.rpc("publish_my_storefront");

      setPublishing(false);
      if (error) {
        toast.error(error.message || "Failed to publish storefront.");
        return;
      }

      setIsPublished(true);
      toast.success("Storefront published! Your store is now live.");
    } catch (err: any) {
      setPublishing(false);
      toast.error(err?.message || "Publishing failed.");
    }
  };

  const storeUrl = `https://${storeSlug || "store"}.stores.dokanos.app`;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 py-8">
      <Card className="w-full max-w-xl shadow-2xl border-border/40">
        <CardHeader className="text-center space-y-2 pb-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-semibold mx-auto mb-1">
            <Sparkles className="h-3.5 w-3.5" /> Setup Complete
          </div>
          <img src={dokanosLogo} alt="DokanOS" className="mx-auto h-20 w-auto object-contain" />
          <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome to DokanOS, {businessName}!
          </CardTitle>
          <CardDescription className="text-sm max-w-md mx-auto">
            Your store infrastructure, default warehouse, catalog, and POS terminal are ready to use.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Storefront Card */}
          <div className="p-4 rounded-xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm">Online Storefront</h3>
              </div>
              <Badge variant={isPublished ? "default" : "secondary"} className={isPublished ? "bg-emerald-500 text-white" : ""}>
                {isPublished ? "Live & Published" : "Draft (Offline)"}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Your modern, responsive online storefront is generated and pre-linked to your inventory.
            </p>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border/30 text-xs">
              <div className="flex items-center gap-2 truncate pr-2">
                <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-foreground truncate">{storeUrl}</span>
              </div>
              {isPublished && (
                <a
                  href={storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline font-medium shrink-0 ml-2"
                >
                  Visit <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {!isPublished ? (
              <Button
                onClick={handlePublish}
                disabled={publishing}
                className="w-full gap-2 bg-primary text-primary-foreground"
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                Publish Storefront to Web
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Your storefront is live and receiving visitors!
              </div>
            )}
          </div>

          {/* Security & MFA Nudge */}
          <div className="p-4 rounded-xl border border-border/40 bg-card/60 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="font-semibold text-foreground text-sm">Protect your business with 2FA</h4>
              <p className="text-muted-foreground">
                Enhance your account security with two-factor authentication (TOTP) from your Settings anytime.
              </p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row gap-3 border-t border-border/30 pt-4">
          <Button
            onClick={() => navigate("/")}
            className="w-full sm:flex-1 gap-2 text-base py-5"
          >
            Enter Dashboard <ArrowRight className="h-4 w-4" />
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
