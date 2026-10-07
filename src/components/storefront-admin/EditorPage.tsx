import { ReactNode, useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import type { Storefront } from "@/storefront/lib/brand";

/**
 * Shared editor page chrome (overhaul 1.3): title + preview iframe on the
 * right when the surface has one.
 *
 * Live preview pipeline: instead of reloading the iframe on save, the parent
 * posts {type: "preview-storefront", storefront} to the iframe — the preview
 * surface swaps the storefront in place and re-renders (no full page load).
 * Posts retry (with ack handshake) until the iframe app is ready.
 */
export default function EditorPage({ children, previewUrl, liveStorefront, device = "desktop" }: {
  children: ReactNode;
  previewUrl?: string;
  /** Latest saved storefront row — posted to the preview iframe after each save. */
  liveStorefront?: Storefront | null;
  device?: "desktop" | "mobile";
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  // Ack handshake: iframe posts preview-ack when its message listener is up.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "preview-ack") setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Post the storefront whenever (a) the iframe acks, or (b) a new save lands.
  useEffect(() => {
    if (!liveStorefront || !previewUrl) return;
    const post = () => iframeRef.current?.contentWindow?.postMessage(
      { type: "preview-storefront", storefront: liveStorefront }, "*",
    );
    if (ready) { post(); return; }
    // Not ready yet: retry until the iframe app acks (max ~15s).
    let tries = 0;
    const t = window.setInterval(() => {
      tries++;
      post();
      if (tries > 30) window.clearInterval(t);
    }, 500);
    return () => window.clearInterval(t);
  }, [liveStorefront, ready, previewUrl]);

  return (
    <div className={previewUrl ? "grid gap-6 items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}>
      <div className="space-y-4">{children}</div>
      {previewUrl && (
        <div className="xl:sticky xl:top-24">
          <div className="rounded-xl border border-border overflow-hidden bg-muted/20">
            <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Globe className="h-3 w-3" />
                {device === "mobile" ? "Mobile" : "Desktop"}
              </span>
              <span className="flex-1 truncate text-[11px] text-muted-foreground">{previewUrl}</span>
            </div>
            <div className={device === "mobile" ? "mx-auto max-w-[390px]" : "w-full"}>
              <iframe
                ref={iframeRef}
                src={previewUrl}
                title="Storefront preview"
                className="w-full h-[calc(100vh-10rem)] min-h-[520px] border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            Preview updates live after each save — no reload needed.
          </p>
        </div>
      )}
    </div>
  );
}
