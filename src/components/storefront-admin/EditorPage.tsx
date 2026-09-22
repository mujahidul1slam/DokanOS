import { ReactNode, useEffect, useRef } from "react";

/**
 * Shared editor page chrome (Phase F): title + preview iframe on the right
 * when the surface has one. The iframe reloads whenever `previewKey` changes
 * (save-then-reload contract: editors bump previewKey on save).
 */
export default function EditorPage({ children, previewUrl, previewKey, device = "desktop" }: {
  children: ReactNode;
  previewUrl?: string;
  previewKey?: number;
  device?: "desktop" | "mobile";
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current && previewKey !== undefined) {
      iframeRef.current.src = previewUrl ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}_k=${previewKey}` : "";
    }
  }, [previewKey, previewUrl]);

  return (
    <div className={previewUrl ? "grid xl:grid-cols-[minmax(0,520px)_1fr] gap-6 items-start" : ""}>
      <div className="space-y-4">{children}</div>
      {previewUrl && (
        <div className="xl:sticky xl:top-24">
          <div className="rounded-xl border border-border overflow-hidden bg-muted/20">
            <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              <span className="ml-2 text-[10px] text-muted-foreground truncate">
                {device === "mobile" ? "Mobile preview" : "Desktop preview"} · {previewUrl}
              </span>
            </div>
            <div className={device === "mobile" ? "mx-auto max-w-[390px]" : "w-full"}>
              <iframe
                ref={iframeRef}
                src={previewUrl}
                title="Storefront preview"
                className="w-full h-[640px] border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            Preview shows the saved state. Hit Save to refresh it.
          </p>
        </div>
      )}
    </div>
  );
}
