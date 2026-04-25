import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    deferredInstallPrompt?: BeforeInstallPromptEvent;
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.deferredInstallPrompt = event as BeforeInstallPromptEvent;
  window.dispatchEvent(new Event("omnisync-install-ready"));
});

window.addEventListener("appinstalled", () => {
  window.deferredInstallPrompt = undefined;
});

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker so the site is a true installable PWA
// (enables "Install app" prompt + app drawer entry on Android).
// Skip inside Lovable preview iframes to avoid stale-cache issues during editing.
if ("serviceWorker" in navigator) {
  const isInIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();
  const isPreviewHost =
    window.location.hostname.includes("id-preview--") ||
    window.location.hostname.includes("lovableproject.com");

  if (isInIframe || isPreviewHost) {
    // Clean up any previously registered SW in preview/iframe contexts
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration failed:", err);
      });
    });
  }
}
