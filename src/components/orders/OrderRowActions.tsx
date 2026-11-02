import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { PAYMENT_NEEDS_CONFIRMATION_LABEL } from "@/lib/paymentGate";
import {
  gateLockedMessage,
  isQuickActionLocked,
  type GateWiringOrder,
} from "@/lib/paymentGateWiring";

export type QuickAction = {
  key: string;
  label: string;
  icon: any;
  onClick: () => void;
  destructive?: boolean;
};

interface Props {
  actions: QuickAction[];
  max: number;
  /**
   * Issue #27: the row's order. When provided, quick actions that book a
   * courier (dispatch, attach/replace parcel) or change status are skipped
   * for gated orders — the click shows the "locked" toast instead. Omit it
   * and the gate is not applied on this surface.
   */
  order?: GateWiringOrder | null;
}

const OrderRowActions = ({ actions, max, order }: Props) => {
  const { toast } = useToast();
  const inline = actions.slice(0, max);
  const overflow = actions.slice(max);
  // Issue #27: gate-aware click wrapper — skip the action for gated orders
  // ("Payment Needs Confirmation") and name the skipped order in a brief toast.
  const runAction = (a: QuickAction, locked: boolean) => {
    if (locked && order) {
      toast({ title: gateLockedMessage([order]) });
      return;
    }
    a.onClick();
  };
  return (
    <div className="flex items-center justify-end gap-0.5">
      <TooltipProvider delayDuration={200}>
        {inline.map((a) => {
          const locked = order ? isQuickActionLocked(a.key, order) : false;
          return (
            <Tooltip key={a.key}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    a.destructive && "text-destructive hover:text-destructive",
                    locked && "opacity-50",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    runAction(a, locked);
                  }}
                  aria-label={a.label}
                  aria-disabled={locked || undefined}
                >
                  <a.icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {locked
                  ? `${a.label} (locked — ${PAYMENT_NEEDS_CONFIRMATION_LABEL})`
                  : a.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((a) => {
              const locked = order ? isQuickActionLocked(a.key, order) : false;
              return (
                <DropdownMenuItem
                  key={a.key}
                  onClick={() => runAction(a, locked)}
                  className={cn(
                    a.destructive && "text-destructive focus:text-destructive",
                    locked && "opacity-50",
                  )}
                  aria-disabled={locked || undefined}
                >
                  <a.icon className="h-4 w-4 mr-2" />{" "}
                  {locked
                    ? `${a.label} (locked — ${PAYMENT_NEEDS_CONFIRMATION_LABEL})`
                    : a.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default OrderRowActions;
