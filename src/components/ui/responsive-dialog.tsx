import { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class for desktop dialog. e.g. "max-w-3xl" */
  desktopMaxWidth?: string;
  /** Hide title visually but keep for a11y. */
  hideTitle?: boolean;
  className?: string;
}

/**
 * Renders a centered Dialog on desktop and a bottom-anchored full-height
 * Sheet on mobile. The mobile sheet uses near-full screen height, has a
 * scrollable body, and pins the footer to the bottom (above safe-area).
 */
export const ResponsiveDialog = ({
  open,
  onOpenChange,
  title,
  children,
  footer,
  desktopMaxWidth = "max-w-3xl",
  hideTitle = false,
  className,
}: ResponsiveDialogProps) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            "h-[100dvh] max-h-[100dvh] w-full p-0 flex flex-col rounded-t-none border-0",
            className
          )}
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
          }}
        >
          {title && (
            <SheetHeader className="px-4 pt-3 pb-2 border-b border-border text-left shrink-0">
              <SheetTitle className={cn("text-base", hideTitle && "sr-only")}>
                {title}
              </SheetTitle>
            </SheetHeader>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
          {footer && (
            <SheetFooter
              className="px-4 py-3 border-t border-border shrink-0 sm:flex-row sm:justify-end"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
            >
              {footer}
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(desktopMaxWidth, "max-h-[90vh] flex flex-col", className)}>
        {title && (
          <DialogHeader>
            <DialogTitle className={cn(hideTitle && "sr-only")}>{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="flex-1 overflow-y-auto pr-1">{children}</div>
        {footer && <DialogFooter className="mt-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
};
