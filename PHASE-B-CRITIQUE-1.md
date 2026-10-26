# PHASE-B-CRITIQUE-1.md — Phase B runtime parity (commit d1705c0)

**VERDICT: REVISE — 1 actionable finding**

1. **Checkout.tsx:273 — stepper off-by-one (actionable).** `<CheckoutStepper current={2} />` with `STEPS = ["Cart", "Details", "Done"]` renders `done = i < current` → Cart AND Details marked completed, `active = i === 2` → "Done" shown as the active step while the user is still filling the checkout (Details) form and has not placed the order. Fix: `current={1}` so Details is active, Done is future. (The stepper's own comment "Cart → Contact & payment → Done" confirms checkout = Details step.)

### Verified — PASS (no action)

- **CartDrawer.tsx** — `update(it.product_id, it.variation_id, it.quantity ± 1)` and `remove(it.product_id, it.variation_id)` match cart.ts signatures exactly. Escape effect guarded by `if (!open) return`, listener removed in cleanup, deps `[open, onClose]` correct. `if (!open) return null` with all hooks (useBrand, useCart, useCurrency, useEffect) preceding the early return — no hooks-order crash. Cross-tab sync works via cart.ts `storage` listener.
- **StorefrontLayout.tsx** — cart `Link` → `<button type="button" onClick={() => setCartOpen(true)}>` (StorefrontLayout.tsx:122-135), no navigation; `<CartDrawer>` at :184 sits between `<main>` and `<footer>`. Only the cart Link→button swap touched the header; announcement bar, nav links, menu toggle, useScrollAnimations from the previous wave all intact.
- **Track.tsx StatusTimeline** — all three `pre_order_*` statuses map to "pending" (idx 0); `reached = Math.max(effectiveIdx, courierPicked ? 2 : effectiveIdx)` correctly elevates to shipped when `tracking_status` present, and never lowers a later status (delivered idx 3 beats 2); cancelled/returned render terminal badges before the ladder; ladder math correct (dots `i <= reached`, connectors `i < reached`, `current` suppressed when delivered). Unknown status falls back to idx 0 — safe.

### Residual notes (minor, non-blocking)

- N1 — CartDrawer header shows `items.length` (line count) while the layout cart badge shows `count` (total quantity) — inconsistent with multi-qty items.
- N2 — No body scroll lock while drawer is open (background scrolls behind the fixed overlay); same class as the acknowledged missing focus trap.
- N3 — Inline `onClose` prop changes identity every layout render, re-subscribing the Escape listener per render — harmless (React removes old listener first).
