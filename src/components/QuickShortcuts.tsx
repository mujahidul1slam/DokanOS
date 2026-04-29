import { Link } from "react-router-dom";
import { Plus, Monitor, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import dokanosLogo from "@/assets/dokanos-logo-horizontal.png";

const QuickShortcuts = () => (
  <div className="sticky top-0 z-30 -mx-4 -mt-4 mb-4 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:-mx-6 lg:-mt-6 lg:px-6">
    {/* Mobile: logo row above shortcuts */}
    <div className="flex h-10 items-center justify-end pl-12 lg:hidden">
      <img src={dokanosLogo} alt="DokanOS" className="h-6 w-auto object-contain" />
    </div>

    {/* Shortcuts row */}
    <div className="flex h-14 items-center gap-1.5 flex-nowrap overflow-x-auto pl-12 lg:pl-0 lg:h-14 scrollbar-none -mt-10 lg:mt-0">
      <Button asChild size="sm" className="gap-1 shrink-0 h-8 px-2.5 text-xs">
        <Link to="/orders?new=1">
          <Plus className="h-3.5 w-3.5" /> Add Order
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm" className="gap-1 shrink-0 h-8 px-2.5 text-xs">
        <Link to="/pos">
          <Monitor className="h-3.5 w-3.5" /> POS
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        className="gap-1 shrink-0 h-8 px-2.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
      >
        <Link to="/pos/reports">
          <BarChart3 className="h-3.5 w-3.5" /> POS Reports
        </Link>
      </Button>

      {/* Desktop: logo on the far right */}
      <img src={dokanosLogo} alt="DokanOS" className="hidden lg:block ml-auto h-7 w-auto object-contain shrink-0" />
    </div>
  </div>
);

export default QuickShortcuts;
