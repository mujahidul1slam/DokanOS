import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Monitor,
  Store,
  Settings,
} from "lucide-react";
  Store,
  Settings,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ShoppingCart, label: "Orders", path: "/orders" },
  { icon: Package, label: "Products", path: "/products" },
  { icon: Users, label: "Customers", path: "/customers" },
  { icon: Monitor, label: "POS", path: "/pos" },
  { icon: Store, label: "Stores", path: "/stores" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const AppSidebar = () => {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <span className="font-heading text-xs font-bold text-primary-foreground">O</span>
        </div>
        <span className="font-heading text-base font-semibold text-foreground">OmniSync</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-3">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-sidebar-accent text-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            AD
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">Admin</p>
            <p className="truncate text-xs text-muted-foreground">admin@omnisync.io</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
