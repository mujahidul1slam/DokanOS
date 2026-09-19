import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { StorefrontAnimationSettings } from "./settings";

/**
 * Storefront scroll animation runtime.
 *
 * Applies one entrance effect to every element marked with `data-sf-anim`.
 * Safety rules (Bonik parity): never runs on checkout-critical routes, and
 * users with `prefers-reduced-motion` always see the store still.
 *
 * Grid cascade: containers opt in with `data-sf-anim-cascade` — each direct
 * child gets a progressive transition delay (gap from settings).
 */

const EXCLUDED_PATHS = ["/cart", "/checkout", "/order-success", "/track", "/track-order"];

function motionAllowed(a: StorefrontAnimationSettings): boolean {
  if (!a.enabled) return false;
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (!a.animate_on_phones && window.innerWidth < 768) return false;
  return true;
}

export function useScrollAnimations(a: StorefrontAnimationSettings) {
  const loc = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    if (!motionAllowed(a) || EXCLUDED_PATHS.some((p) => loc.pathname.includes(p))) {
      root.removeAttribute("data-sf-anim-root");
      return;
    }

    root.setAttribute("data-sf-anim-root", "");
    root.style.setProperty("--sf-anim-speed", `${a.speed_ms}ms`);
    root.style.setProperty("--sf-anim-cascade-gap", `${a.cascade_gap_ms}ms`);
    root.setAttribute("data-sf-anim-effect", a.effect);
    root.setAttribute("data-sf-anim-strength", a.strength);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("sf-anim-in");
          if (a.play_once) io.unobserve(e.target);
        }
      },
      { threshold: 0.12 },
    );

    const scan = () => {
      // Sections use data-sf-anim; card grids use data-sf-anim-cascade.
      // Both get .sf-anim-in when they enter view; cascade children stagger via CSS delay ladder.
      document
        .querySelectorAll<HTMLElement>("[data-sf-anim]:not([data-sf-observed]), [data-sf-anim-cascade]:not([data-sf-observed])")
        .forEach((el) => {
          el.setAttribute("data-sf-observed", "1");
          if (a.animate_on_load) {
            io.observe(el);
          } else {
            // Off-page only: elements already in viewport at load render normally.
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight) el.classList.add("sf-anim-in");
            else io.observe(el);
          }
        });
    };

    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      root.removeAttribute("data-sf-anim-root");
      root.removeAttribute("data-sf-anim-effect");
      root.removeAttribute("data-sf-anim-strength");
      document.querySelectorAll("[data-sf-observed]").forEach((el) => el.removeAttribute("data-sf-observed"));
    };
  }, [a, loc.pathname]);
}
