/**
 * Shared plumbing for the print popups (invoice, pickup slip, measurement slip).
 *
 * Every print document embeds PRINT_BOOTSTRAP and nothing else calls print().
 * Triggering print() a second time from the opener makes Chrome re-spool the
 * whole job, which on non-thermal drivers can produce multi-GB output.
 */

/**
 * Inline bootstrap for a print popup: wait for webfonts and images to settle,
 * print once, then close when the job is handed off.
 *
 * Both waits earn their keep. Printing before an <img> has loaded silently
 * drops it from the output — the logo lives on a remote Supabase URL, so a
 * fixed timer loses that race on a slow connection. And closing the window on
 * a timer instead of on afterprint can truncate a job that is still spooling.
 *
 * The 3s cap means a stalled remote asset delays printing rather than blocking
 * it forever.
 */
export const PRINT_BOOTSTRAP = `<script>
(function () {
  var printed = false;
  function go() {
    if (printed) return;
    printed = true;
    try { window.focus(); } catch (e) {}
    window.print();
  }
  window.onafterprint = function () { window.close(); };
  window.onload = function () {
    var waits = [];
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
    Array.prototype.forEach.call(document.images, function (img) {
      if (img.complete) return;
      waits.push(new Promise(function (res) {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }));
    });
    var cap = new Promise(function (res) { setTimeout(res, 3000); });
    Promise.race([Promise.all(waits), cap]).then(go, go);
  };
})();
<\/script>`;

/**
 * Opens a popup and writes a complete print document into it. The document is
 * expected to carry PRINT_BOOTSTRAP; this helper never calls print() itself.
 * Returns false when the popup was blocked.
 */
export function openPrintWindow(html: string): boolean {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  return true;
}
