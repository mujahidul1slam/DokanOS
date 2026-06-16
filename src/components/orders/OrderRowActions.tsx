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
}

const OrderRowActions = ({ actions, max }: Props) => {
  const inline = actions.slice(0, max);
  const overflow = actions.slice(max);
  return (
    <div className="flex items-center justify-end gap-0.5">
      <TooltipProvider delayDuration={200}>
        {inline.map((a) => (
          <Tooltip key={a.key}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  a.destructive && "text-destructive hover:text-destructive",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  a.onClick();
                }}
                aria-label={a.label}
              >
                <a.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{a.label}</TooltipContent>
          </Tooltip>
        ))}
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
            {overflow.map((a) => (
              <DropdownMenuItem
                key={a.key}
                onClick={a.onClick}
                className={cn(
                  a.destructive && "text-destructive focus:text-destructive",
                )}
              >
                <a.icon className="h-4 w-4 mr-2" /> {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default OrderRowActions;
