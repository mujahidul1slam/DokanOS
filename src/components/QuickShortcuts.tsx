import { Link } from "react-router-dom";
import { Plus, Monitor, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

const QuickShortcuts = () => (
  <div className="sticky top-0 z-30 -mx-4 -mt-16 mb-4 border-b border-border bg-background/80 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:-mx-6 lg:-mt-6 lg:px-6">
    <div className="flex items-center gap-2 flex-wrap pl-12 lg:pl-0">
      <Button asChild size="sm" className="gap-1.5">
        <Link to="/orders?new=1">
          <Plus className="h-4 w-4" /> Add New Order
        </Link>
      </Button>
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link to="/pos">
          <Monitor className="h-4 w-4" /> POS
        </Link>
      </Button>
      <Button
        asChild
        size="sm"
        className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
      >
        <Link to="/pos/reports">
          <BarChart3 className="h-4 w-4" /> POS Reports
        </Link>
      </Button>
    </div>
  </div>
);

export default QuickShortcuts;
