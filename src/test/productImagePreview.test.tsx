import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProductImagePreview from "@/components/products/ProductImagePreview";

// jsdom (vitest's environment) has no PointerEvent carrying pointerType — the
// value is dropped by the generic Event constructor. Emulate the browser's
// PointerEvent so pointer-type gating is exercised as it works in real browsers.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// Acceptance tests for issue #26 (Q31): hover/tap enlarged product image preview
// on the Products page.
const IMG = "https://cdn.example.com/products/red-kurta.jpg";

const getThumb = () => screen.getByTestId("product-image-thumb");
const queryPreview = () => screen.queryByTestId("product-image-preview");

describe("ProductImagePreview — desktop hover (acceptance 1)", () => {
  it("hovering the thumbnail shows a bounded enlarged preview near it; leaving hides it", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    const thumb = getThumb();
    expect(queryPreview()).toBeNull();

    fireEvent.mouseOver(thumb); // desktop hover
    const preview = screen.getByTestId("product-image-preview");
    expect(preview).toBeInTheDocument();
    // bounded: fixed 224×224 box (w-56 h-56)
    expect(preview).toHaveClass("w-56");
    expect(preview).toHaveClass("h-56");
    // near the thumbnail: anchored to its rect, clamped to the viewport
    expect(preview.style.top).not.toBe("");
    expect(preview.style.left).not.toBe("");

    fireEvent.mouseOut(thumb);
    expect(queryPreview()).toBeNull();
  });

  it("pointer hover with a mouse pointer also shows the preview", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.pointerOver(getThumb(), { pointerType: "mouse" });
    expect(queryPreview()).toBeInTheDocument();
    fireEvent.pointerOut(getThumb(), { pointerType: "mouse" });
    expect(queryPreview()).toBeNull();
  });

  it("a touch pointer hover alone never leaves a sticky preview", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.pointerOver(getThumb(), { pointerType: "touch" });
    expect(queryPreview()).toBeNull();
  });
});

describe("ProductImagePreview — tap/click (acceptance 2)", () => {
  it("a touch tap shows the preview and a second tap toggles it closed", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-12 w-12" />);
    const thumb = getThumb();

    fireEvent.pointerDown(thumb, { pointerType: "touch" });
    fireEvent.click(thumb);
    expect(queryPreview()).toBeInTheDocument();

    fireEvent.pointerDown(thumb, { pointerType: "touch" });
    fireEvent.click(thumb);
    expect(queryPreview()).toBeNull();
  });

  it("click shows the same preview (tap or click parity) and toggles it closed", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    const thumb = getThumb();
    fireEvent.click(thumb);
    expect(queryPreview()).toBeInTheDocument();
    fireEvent.click(thumb);
    expect(queryPreview()).toBeNull();
  });

  it("closes on outside tap", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.click(getThumb());
    expect(queryPreview()).toBeInTheDocument();

    fireEvent.touchStart(document.body);
    expect(queryPreview()).toBeNull();
  });

  it("closes on outside pointer press", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.click(getThumb());
    expect(queryPreview()).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(queryPreview()).toBeNull();
  });

  it("closes on Escape", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.click(getThumb());
    expect(queryPreview()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryPreview()).toBeNull();
  });

  it("activating the thumbnail does not trigger row handlers", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />
      </div>
    );
    fireEvent.click(getThumb());
    expect(queryPreview()).toBeInTheDocument();
    expect(rowClick).not.toHaveBeenCalled();
  });
});

describe("ProductImagePreview — layout and row actions (acceptance 3)", () => {
  it("the preview is a fixed out-of-flow layer that never blocks row actions", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.click(getThumb());
    const preview = screen.getByTestId("product-image-preview");
    // no layout shift: rendered fixed, outside the table/grid flow
    expect(preview).toHaveClass("fixed");
    // never blocks row actions: clicks pass through the overlay
    expect(preview).toHaveClass("pointer-events-none");
  });
});

describe("ProductImagePreview — products without an image (acceptance 4)", () => {
  it("shows the placeholder only and never opens a preview", () => {
    render(<ProductImagePreview src={null} alt="Mystery Product" className="h-9 w-9" />);
    const thumb = getThumb();
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.querySelector("svg")).not.toBeNull();

    fireEvent.mouseOver(thumb);
    expect(queryPreview()).toBeNull();
    fireEvent.click(thumb);
    expect(queryPreview()).toBeNull();
  });
});

describe("ProductImagePreview — hotlinked CDN safety", () => {
  it("every image uses referrerPolicy=no-referrer", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    const thumbImg = getThumb().querySelector("img");
    expect(thumbImg).toHaveAttribute("referrerpolicy", "no-referrer");

    fireEvent.click(getThumb());
    const previewImg = screen.getByTestId("product-image-preview").querySelector("img");
    expect(previewImg).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("falls back to the placeholder when the thumbnail image fails to load", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    const img = getThumb().querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
    const fallback = img.nextElementSibling as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.style.display).toBe("flex");
  });

  it("falls back to the placeholder when the enlarged preview image fails to load", () => {
    render(<ProductImagePreview src={IMG} alt="Red Kurta" className="h-9 w-9" />);
    fireEvent.click(getThumb());
    const img = screen.getByTestId("product-image-preview").querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.display).toBe("none");
    const fallback = img.nextElementSibling as HTMLElement;
    expect(fallback).not.toBeNull();
    expect(fallback.style.display).toBe("flex");
  });
});
