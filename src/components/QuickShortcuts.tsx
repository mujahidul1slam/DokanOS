import { Link } from "react-router-dom";
import { Plus, Monitor, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import dokanosLogo from "@/assets/dokanos-logo-horizontal.png";

const QuickShortcuts = () => {
  return (
  <div className="sticky top-0 z-30 -mx-4 -mt-4 mb-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 backdrop-blur-xl lg:-mx-6 lg:-mt-6 lg:px-6">
    {/* Mobile-only: centered, full-width logo row above shortcuts */}
    <div className="flex h-12 items-center justify-center lg:hidden mt-2">
      <img src={dokanosLogo} alt="DokanOS" className="h-full w-auto max-w-[200px] object-contain py-1" />
    </div>

    {/* Shortcuts row (with logo on right for desktop) */}
    <div className="flex h-16 lg:h-[4.5rem] items-center gap-1.5 flex-wrap lg:flex-nowrap pl-12 lg:pl-0">
      <Button asChild size="sm" className="gap-1 shrink-0 h-8 px-2.5 text-xs">
        <Link to="/orders?new=1">
          <Plus className="h-3.5 w-3.5" /> Add Order
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        className="gap-1 shrink-0 h-8 px-2.5 text-xs bg-yellow-400 text-black hover:bg-yellow-500 dark:bg-yellow-400 dark:hover:bg-yellow-500"
      >
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

      {/* Desktop-only: logo on the right */}
      <div className="hidden lg:flex ml-auto items-center shrink-0">
        <img src={dokanosLogo} alt="DokanOS" className="h-8 w-auto object-contain shrink-0 opacity-80" />
      </div>
    </div>
  </div>
  );
};

export default QuickShortcuts;
