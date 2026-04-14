import { useEffect, useCallback, useRef } from "react";

/**
 * Detects rapid barcode scanner input (characters arriving < 50ms apart)
 * and calls onScan with the scanned string.
 */
export function useBarcodeScanner(onScan: (barcode: string) => void) {
  const buffer = useRef("");
  const lastKeyTime = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea
    const target = e.target as HTMLElement;
    const tagName = target.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable) {
      // Allow barcode scanner in the POS search field specifically
      if (!(target as HTMLInputElement).dataset?.barcodeEnabled) return;
    }

    const now = Date.now();
    const timeDiff = now - lastKeyTime.current;

    if (e.key === "Enter" && buffer.current.length >= 4) {
      e.preventDefault();
      onScan(buffer.current);
      buffer.current = "";
      if (timeout.current) clearTimeout(timeout.current);
      return;
    }

    if (e.key.length === 1) {
      if (timeDiff > 100) {
        // Too slow — reset buffer (human typing)
        buffer.current = e.key;
      } else {
        buffer.current += e.key;
      }
      lastKeyTime.current = now;

      // Clear buffer after 200ms of no input
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => {
        buffer.current = "";
      }, 200);
    }
  }, [onScan]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [handleKeyDown]);
}
