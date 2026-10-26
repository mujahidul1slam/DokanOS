import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";

// Cloudflare test site key that always passes (documentation default)
const DEFAULT_SITE_KEY =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

export interface TurnstileWidgetRef {
  reset: () => void;
  getToken: () => string | null;
}

interface TurnstileWidgetProps {
  onSuccess?: (token: string) => void;
  onError?: (err?: any) => void;
  onExpire?: () => void;
  siteKey?: string;
  action?: string;
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        params: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: (error?: any) => void;
          "expired-callback"?: () => void;
          action?: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      getResponse: (widgetId: string) => string | undefined;
    };
    onloadTurnstileCallback?: () => void;
  }
}

export const TurnstileWidget = forwardRef<TurnstileWidgetRef, TurnstileWidgetProps>(
  ({ onSuccess, onError, onExpire, siteKey = DEFAULT_SITE_KEY, action, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      reset: () => {
        tokenRef.current = null;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.reset(widgetIdRef.current);
          } catch (e) {
            console.warn("Turnstile reset error:", e);
          }
        }
      },
      getToken: () => {
        if (tokenRef.current) return tokenRef.current;
        if (widgetIdRef.current && window.turnstile) {
          return window.turnstile.getResponse(widgetIdRef.current) || null;
        }
        // Fallback test token in development
        if (import.meta.env.DEV) {
          return `test-token-${Date.now()}`;
        }
        return null;
      },
    }));

    useEffect(() => {
      let isMounted = true;

      const initTurnstile = () => {
        if (!containerRef.current || !window.turnstile || widgetIdRef.current) return;
        try {
          const id = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            action,
            theme: "auto",
            callback: (token: string) => {
              if (!isMounted) return;
              tokenRef.current = token;
              onSuccess?.(token);
            },
            "error-callback": (err: any) => {
              if (!isMounted) return;
              console.warn("Turnstile widget error:", err);
              // In dev fallback to passing token
              if (import.meta.env.DEV) {
                tokenRef.current = `test-token-${Date.now()}`;
                onSuccess?.(tokenRef.current);
              } else {
                onError?.(err);
              }
            },
            "expired-callback": () => {
              if (!isMounted) return;
              tokenRef.current = null;
              onExpire?.();
            },
          });
          widgetIdRef.current = id;
        } catch (err) {
          console.warn("Failed to render Turnstile widget:", err);
          if (import.meta.env.DEV) {
            tokenRef.current = `test-token-${Date.now()}`;
            onSuccess?.(tokenRef.current);
          }
        }
      };

      if (!window.turnstile) {
        const existingScript = document.getElementById("turnstile-script");
        if (!existingScript) {
          const script = document.createElement("script");
          script.id = "turnstile-script";
          script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
          script.async = true;
          script.defer = true;
          script.onload = () => {
            initTurnstile();
          };
          script.onerror = () => {
            console.warn("Could not load Turnstile script, using dev fallback");
            if (import.meta.env.DEV) {
              tokenRef.current = `test-token-${Date.now()}`;
              onSuccess?.(tokenRef.current);
            }
          };
          document.head.appendChild(script);
        } else {
          existingScript.addEventListener("load", initTurnstile);
        }
      } else {
        initTurnstile();
      }

      return () => {
        isMounted = false;
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {}
          widgetIdRef.current = null;
        }
      };
    }, [siteKey, action]);

    return <div ref={containerRef} className={className || "my-2 flex justify-center"} />;
  }
);

TurnstileWidget.displayName = "TurnstileWidget";
