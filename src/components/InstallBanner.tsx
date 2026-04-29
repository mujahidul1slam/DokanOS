import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const STORAGE_KEY = "omnisync_install_banner_dismissed_at";
const DISMISS_HOURS = 72;

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as any).MSStream;

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

const wasRecentlyDismissed = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return false;
    const ts = Number(v);
    if (!ts) return false;
    return Date.now() - ts < DISMISS_HOURS * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

const InstallBanner = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== "undefined" ? window.deferredInstallPrompt ?? null : null)
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    const showIfReady = () => {
      const ready = window.deferredInstallPrompt ?? deferred;
      if (ready || isIOS()) setVisible(true);
    };

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const ready = () => {
      setDeferred(window.deferredInstallPrompt ?? null);
      showIfReady();
    };
    const installedHandler = () => setVisible(false);

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("omnisync-install-ready", ready);
    window.addEventListener("appinstalled", installedHandler);
    showIfReady();

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("omnisync-install-ready", ready);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* noop */ }
    setVisible(false);
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        toast.success("App installed");
      }
      setDeferred(null);
      window.deferredInstallPrompt = undefined;
      setVisible(false);
      return;
    }
    if (isIOS()) {
      toast.info("Tap the Share icon in Safari, then 'Add to Home Screen'.");
      return;
    }
    toast.info("Open this site in Chrome/Edge, then use the browser menu → 'Add to Home screen'.");
  };

  if (!visible) return null;

  return (
    <div
      className="lg:hidden fixed left-3 right-3 z-40 rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg p-3 flex items-center gap-3"
      style={{ bottom: "calc(64px + env(safe-area-inset-bottom, 0px) + 8px)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">Install DokanOS</div>
        <p className="text-xs text-muted-foreground truncate">Add to home screen for a faster, native-like experience.</p>
      </div>
      <Button onClick={install} size="sm" className="gap-1.5 shrink-0 h-9 px-3">
        <Download className="h-4 w-4" /> Install
      </Button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 rounded-md hover:bg-muted text-muted-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default InstallBanner;
