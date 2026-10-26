import { useCallback, useEffect, useRef, useState, type SyntheticEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Image as ImageIcon } from "lucide-react";

/**
 * Product thumbnail with an enlarged preview (issue #26 / Q31).
 *
 * - Desktop: hovering the thumbnail shows a bounded enlarged preview near it.
 * - Touch: tapping (or clicking) the thumbnail shows the same preview; it closes
 *   on an outside tap, on Escape, or by activating the thumbnail again.
 * - The preview is a fixed, pointer-events-none layer, so it never shifts the
 *   product table/grid layout and never blocks row actions.
 * - Products without an image show the placeholder only and never open a preview.
 * - Hotlinked CDN images use referrerPolicy="no-referrer" with an onError
 *   placeholder fallback (pattern: src/components/orders/MiniProductCatalog.tsx).
 */

interface ProductImagePreviewProps {
  /** Product image URL, or null when the product has no image. */
  src: string | null;
  /** Product name, used for alt text and accessible labels. */
  alt: string;
  /** Tailwind classes sizing the thumbnail box, e.g. "h-9 w-9". */
  className?: string;
}

const PREVIEW_SIZE = 224; // px, keep in sync with the w-56 h-56 preview box
const PREVIEW_GAP = 12;
const VIEWPORT_MARGIN = 8;

/** Established hotlink fallback: hide the broken image, reveal its placeholder sibling. */
const onImgError = (e: SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  img.style.display = "none";
  const fb = img.nextElementSibling as HTMLElement | null;
  if (fb) fb.style.display = "flex";
};

const ProductImagePreview = ({ src, alt, className = "" }: ProductImagePreviewProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hasImage = !!src;
  const visible = hasImage && (hovered || pinned);

  /** Place the preview next to the thumbnail, clamped inside the viewport. */
  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = r.right + PREVIEW_GAP;
    if (left + PREVIEW_SIZE > vw - VIEWPORT_MARGIN) {
      left = r.left - PREVIEW_SIZE - PREVIEW_GAP;
    }
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, vw - PREVIEW_SIZE - VIEWPORT_MARGIN));

    let top = r.top + r.height / 2 - PREVIEW_SIZE / 2;
    top = Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, vh - PREVIEW_SIZE - VIEWPORT_MARGIN));

    setPos({ top, left });
  }, []);

  const close = useCallback(() => {
    setHovered(false);
    setPinned(false);
  }, []);

  // Hover (desktop) shows the preview while the pointer rests on the thumbnail.
  // Touch pointer events are ignored here so a tap cannot leave a sticky hover
  // preview behind; touch opens the preview through the click handler instead.
  const enterPreview = () => {
    updatePos();
    setHovered(true);
  };
  const handlePointerEnter = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // hover-capable pointers (mouse, pen) preview on hover; touch must tap
    if (e.pointerType !== "touch") enterPreview();
  };
  const handleLeave = () => setHovered(false);

  // Tap or click toggles the preview; it never propagates to row handlers
  // (opening the product sheet), so row actions stay predictable.
  const handleClick = (e: SyntheticEvent) => {
    e.stopPropagation();
    updatePos();
    setHovered(false);
    setPinned((p) => !p);
  };

  // While open: close on outside tap/click or Escape; keep the preview anchored
  // if the page scrolls or resizes.
  useEffect(() => {
    if (!visible) return;

    const onOutside = (e: Event) => {
      const el = triggerRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onMove = () => updatePos();

    const outsideEvents = ["pointerdown", "mousedown", "touchstart", "click"];
    for (const t of outsideEvents) document.addEventListener(t, onOutside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      for (const t of outsideEvents) document.removeEventListener(t, onOutside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [visible, close, updatePos]);

  const thumb = hasImage ? (
    <>
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={onImgError}
      />
      <span className="hidden absolute inset-0 items-center justify-center bg-muted">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
      </span>
    </>
  ) : (
    <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
  );

  const boxClass = `relative flex items-center justify-center overflow-hidden rounded-md bg-muted shrink-0 ${hasImage ? "cursor-pointer" : ""} ${className}`;

  return (
    <>
      {hasImage ? (
        <button
          type="button"
          ref={triggerRef}
          data-testid="product-image-thumb"
          aria-label={`Preview image of ${alt}`}
          aria-expanded={visible}
          className={boxClass}
          onMouseEnter={enterPreview}
          onMouseLeave={handleLeave}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handleLeave}
          onClick={handleClick}
        >
          {thumb}
        </button>
      ) : (
        <div data-testid="product-image-thumb" className={boxClass} aria-label={alt} role="img">
          {thumb}
        </div>
      )}

      {visible &&
        createPortal(
          <div
            data-testid="product-image-preview"
            aria-hidden="true"
            className="pointer-events-none fixed z-50 flex h-56 w-56 items-center justify-center overflow-hidden rounded-lg border border-border bg-card shadow-lg"
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            <img src={src} alt="" className="h-full w-full object-contain" referrerPolicy="no-referrer" onError={onImgError} />
            <span className="hidden absolute inset-0 items-center justify-center bg-secondary/30">
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            </span>
          </div>,
          document.body
        )}
    </>
  );
};

export default ProductImagePreview;
