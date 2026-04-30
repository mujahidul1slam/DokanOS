import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { clearRuntimeCaches, isChunkLoadError, recoverFromChunkLoadError } from "@/lib/chunkRecovery";

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

window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError(event.reason)) {
    event.preventDefault();
    void recoverFromChunkLoadError();
  }
});

createRoot(document.getElementById("root")!).render(<App />);

// Keep the app manifest-installable without registering a runtime service worker.
// If an older release registered one, unregister it so tab/PWA resume cannot reload
// the app through stale worker-controlled navigation.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void clearRuntimeCaches();
  });
}
