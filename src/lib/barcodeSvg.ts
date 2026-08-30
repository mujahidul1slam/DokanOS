import JsBarcode from "jsbarcode";

/**
 * Vector-safe CODE128 barcode as a serialized SVG string.
 *
 * Shared by the pickup slip and invoice print builders, both of which inline
 * the result into print documents where every glyph has to stay vector:
 *
 * Color emoji are bitmap glyphs (CBDT/COLR tables). Chrome's print path cannot
 * express them as vector drawing commands, so it falls back to rasterizing the
 * whole page at the driver's native DPI. On an 80mm thermal roll at 203 DPI
 * that costs ~2MB per page and nobody notices; on A4 landscape at 600 DPI it
 * is ~133MB per page, which is how a slip batch once turned into a
 * multi-gigabyte spool file that hung the machine before printing anything.
 */
export function makeBarcodeSvg(value: string, opts: { height: number; fontSize: number; width: number }): string {
  try {
    if (!value) return "";
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(el, String(value), {
      format: "CODE128",
      displayValue: true,
      height: opts.height,
      fontSize: opts.fontSize,
      width: opts.width,
      margin: 0,
      textMargin: 2,
      background: "#ffffff",
      lineColor: "#000000",
    });
    // Normalize: convert JsBarcode's fixed px width/height into a viewBox so
    // the browser renders the SVG as pure vector at whatever CSS size we ask
    // for. Without this, Chrome's PDF/raster pipeline can balloon to GB-sized
    // output when printing to a non-thermal printer (the SVG gets rasterized
    // at the printer's native DPI per slip).
    const widthAttr = el.getAttribute("width");
    const heightAttr = el.getAttribute("height");
    const w = widthAttr ? parseFloat(widthAttr) : 0;
    const h = heightAttr ? parseFloat(heightAttr) : 0;
    if (w > 0 && h > 0 && !el.getAttribute("viewBox")) {
      el.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    el.removeAttribute("width");
    el.removeAttribute("height");
    el.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return new XMLSerializer().serializeToString(el);
  } catch {
    return "";
  }
}
