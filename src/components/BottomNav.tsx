import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Monitor, Package, Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface Props {
  onMenuClick: () => void;
}

const items = [
  { icon: LayoutDashboard, label: "Home", path: "/", roles: ["admin", "staff", "viewer"] },
  { icon: ShoppingCart, label: "Orders", path: "/orders", roles: ["admin", "staff", "viewer"] },
  { icon: Monitor, label: "POS", path: "/pos", roles: ["admin", "staff"] },
  { icon: Package, label: "Products", path: "/products", roles: ["admin", "staff", "viewer"] },
];


const BottomNav = ({ onMenuClick }: Props) => {
  const location = useLocation();
  const { role } = useAuth();
  const visible = items.filter((i) => role && i.roles.includes(role));

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch justify-around h-14">
        {visible.map((item) => {
          const matchPath = (item as any).match || item.path;
          const isActive =
            matchPath === "/"
              ? location.pathname === "/"
              : location.pathname === matchPath || location.pathname.startsWith(matchPath + "/");
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onMenuClick}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Menu className="h-5 w-5" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
