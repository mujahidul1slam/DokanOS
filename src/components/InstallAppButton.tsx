import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    deferredInstallPrompt?: BeforeInstallPromptEvent;
  }
}

const isIOS = () =>
  typeof navigator !== "undefined" &&
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(window as any).MSStream;

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

const InstallAppButton = () => {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    () => window.deferredInstallPrompt ?? null
  );
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const readyHandler = () => setDeferred(window.deferredInstallPrompt ?? null);
    const installedHandler = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("omnisync-install-ready", readyHandler);
    window.addEventListener("appinstalled", installedHandler);
    readyHandler();
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("omnisync-install-ready", readyHandler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (installed) {
      toast.info("App is already installed");
      return;
    }
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        toast.success("App installed");
        setInstalled(true);
      }
      setDeferred(null);
      window.deferredInstallPrompt = undefined;
      return;
    }
    if (isIOS()) {
      setShowIosHelp(true);
      return;
    }
    toast.info(
      "Installation not available here. Open this site in Chrome/Edge on your phone, then tap the browser menu → 'Add to Home screen'."
    );
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <div className="text-sm font-medium flex items-center gap-2">
            <Smartphone className="h-4 w-4" />
            Install as Mobile App
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
            Install DokanOS on your phone's home screen for a native-like, full-screen experience.
            Works on Android (Chrome/Edge) and iOS (Safari).
          </p>
        </div>
        <Button onClick={handleInstall} size="sm" className="gap-2 shrink-0">
          <Download className="h-4 w-4" />
          {installed ? "Installed" : "Install App"}
        </Button>
      </div>

      {showIosHelp && (
        <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How to install on iPhone / iPad:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open this site in Safari.</li>
            <li>Tap the Share button (square with an arrow).</li>
            <li>Scroll and tap "Add to Home Screen".</li>
            <li>Tap "Add" — the app icon will appear on your home screen.</li>
          </ol>
        </div>
      )}
    </div>
  );
};

export default InstallAppButton;
