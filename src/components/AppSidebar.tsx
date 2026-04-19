import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, Users, Monitor, Plug,
  Settings, UsersRound, LogOut, Menu, X, Search, Sun, Moon, BarChart3, Hourglass,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/ui/button";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/", roles: ["admin", "staff", "viewer"] },
  { icon: ShoppingCart, label: "Orders", path: "/orders", roles: ["admin", "staff", "viewer"], children: [
    { icon: Hourglass, label: "Pre-Orders", path: "/pre-orders", roles: ["admin", "staff", "viewer"] },
  ] },
  { icon: Package, label: "Products", path: "/products", roles: ["admin", "staff"] },
  { icon: Users, label: "Customers", path: "/customers", roles: ["admin", "staff", "viewer"] },
  { icon: Monitor, label: "POS", path: "/pos", roles: ["admin", "staff"] },
  { icon: BarChart3, label: "Analytics", path: "/analytics", roles: ["admin"] },
  { icon: Plug, label: "Integrations", path: "/integrations", roles: ["admin"] },
  { icon: UsersRound, label: "Team", path: "/team", roles: ["admin"] },
  { icon: Settings, label: "Settings", path: "/settings", roles: ["admin"] },
];

const AppSidebar = () => {
  const location = useLocation();
  const { user, role, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = navItems.filter(
    (item) => role && item.roles.includes(role)
  );

  const initials = user?.email?.slice(0, 2).toUpperCase() || "??";

  const sidebar = (
    <>
      <div className="flex h-14 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <span className="font-heading text-xs font-bold text-primary-foreground">O</span>
          </div>
          <span className="font-heading text-base font-semibold text-foreground">OmniSync</span>
        </div>
        <button className="lg:hidden text-muted-foreground" onClick={() => setMobileOpen(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Search hint */}
      <div className="px-3 py-2">
        <button
          onClick={() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true })); setMobileOpen(false); }}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search...</span>
          <kbd className="ml-auto hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-1">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const children = (item as any).children?.filter((c: any) => role && c.roles.includes(role)) || [];
          return (
            <div key={item.path}>
              <Link
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
              {children.map((child: any) => {
                const childActive = location.pathname === child.path;
                return (
                  <Link
                    key={child.path}
                    to={child.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-md pl-9 pr-3 py-1.5 text-xs transition-colors ${
                      childActive
                        ? "bg-sidebar-accent text-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                    }`}
                  >
                    <child.icon className="h-3.5 w-3.5" />
                    {child.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">{user?.email}</p>
            <p className="truncate text-xs capitalize text-muted-foreground">{role || "—"}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={toggleTheme} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed left-4 top-4 z-50 lg:hidden rounded-md bg-card border border-border p-2"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <aside className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-border bg-sidebar transition-transform lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebar}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 z-40 h-screen w-60 flex-col border-r border-border bg-sidebar">
        {sidebar}
      </aside>
    </>
  );
};

export default AppSidebar;
