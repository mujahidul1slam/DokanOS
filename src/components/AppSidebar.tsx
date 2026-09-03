import { useState, useMemo } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  LayoutDashboard, ShoppingCart, Package, Users, Monitor, Plug,
  Settings, UsersRound, LogOut, Menu, X, Search, Sun, Moon, BarChart3, Hourglass, Receipt, ChevronsUpDown, Check, Store,
  PanelLeftClose, PanelLeftOpen, ChevronRight, ChevronDown, PackageCheck, Truck, Clock, CheckCircle2, AlertTriangle, Undo2, XCircle, Trash2, Tags
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useBusinessProfile } from "@/hooks/useBusinessProfile";
import { useBusinessContext } from "@/hooks/useBusinessContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import dokanosIcon from "@/assets/dokanos-icon.png";

type NavGroup = {
  title: string;
  items: {
    icon: any;
    label: string;
    path: string;
    roles: string[];
    children?: { icon: any; label: string; path: string; roles: string[] }[];
  }[];
};

const BASE_NAV_GROUPS: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/", roles: ["admin", "staff", "viewer"] },
      { icon: ShoppingCart, label: "Orders", path: "/orders", roles: ["admin", "staff", "viewer"], children: [
        { icon: Package, label: "New", path: "/orders?tab=new", roles: ["admin", "staff", "viewer"] },
        { icon: Hourglass, label: "Pre-Orders", path: "/orders?tab=pre_order", roles: ["admin", "staff", "viewer"] },
        { icon: PackageCheck, label: "Ready", path: "/orders?tab=ready", roles: ["admin", "staff", "viewer"] },
        { icon: Clock, label: "Pickup", path: "/orders?tab=pickup_pending", roles: ["admin", "staff", "viewer"] },
        { icon: Truck, label: "Transit", path: "/orders?tab=in_transit", roles: ["admin", "staff", "viewer"] },
        { icon: CheckCircle2, label: "Delivered", path: "/orders?tab=delivered", roles: ["admin", "staff", "viewer"] },
        { icon: AlertTriangle, label: "On Hold", path: "/orders?tab=on_hold", roles: ["admin", "staff", "viewer"] },
        { icon: Undo2, label: "Returned", path: "/orders?tab=returned", roles: ["admin", "staff", "viewer"] },
        { icon: XCircle, label: "Cancelled", path: "/orders?tab=cancelled", roles: ["admin", "staff", "viewer"] },
        { icon: Trash2, label: "Trash", path: "/orders?tab=trash", roles: ["admin", "staff", "viewer"] },
      ] },
      { icon: Monitor, label: "POS", path: "/pos", roles: ["admin", "staff"], children: [
        { icon: Receipt, label: "POS Reports", path: "/pos/reports", roles: ["admin"] },
      ] },
    ]
  },
  {
    title: "Catalog",
    items: [
      { icon: Package, label: "Products", path: "/products", roles: ["admin", "staff"], children: [] },
      { icon: Users, label: "Customers", path: "/customers", roles: ["admin", "staff", "viewer"] },
    ]
  },
  {
    title: "System",
    items: [
      { icon: BarChart3, label: "Analytics", path: "/analytics", roles: ["admin"] },
      { icon: Store, label: "Stores", path: "/stores", roles: ["admin", "staff"] },
      { icon: Monitor, label: "Storefronts", path: "/storefronts", roles: ["admin", "staff"] },
      { icon: Plug, label: "Integrations", path: "/integrations", roles: ["admin"] },
      { icon: UsersRound, label: "Team", path: "/team", roles: ["admin"] },
      { icon: Settings, label: "Settings", path: "/settings", roles: ["admin"] },
    ]
  }
];

interface AppSidebarProps {
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const AppSidebar = ({ 
  mobileOpen: mobileOpenProp, 
  onMobileOpenChange,
  collapsed = false,
  onCollapsedChange
}: AppSidebarProps = {}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, role, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { active: legacyProfile, profiles, setActive: setLegacyProfile } = useBusinessProfile();
  // Multi-business Phase 1: prefer real businesses over the invoice_settings
  // profile rows. Same UI shape either way (name + logo + switcher).
  const { active: activeBusiness, businesses, setActive: setActiveBusiness, brands } = useBusinessContext();
  const active = activeBusiness
    ? { id: activeBusiness.id, business_name: activeBusiness.name, logo_url: activeBusiness.logo_url }
    : legacyProfile;
  const switcherList = businesses.length > 0
    ? businesses.map((b) => ({ id: b.id, business_name: b.name, logo_url: b.logo_url }))
    : profiles.map((p) => ({ id: p.id, business_name: p.business_name, logo_url: p.logo_url }));
  const setActive = (id: string) => {
    if (businesses.length > 0) setActiveBusiness(id);
    else setLegacyProfile(id);
  };
  
  // Fetch product categories for sidebar
  const { data: productCategories } = useQuery({
    queryKey: ['product_categories', active?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_categories')
        .select('id, name')
        .eq('store_id', active?.id)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!active?.id,
  });

  const navGroups = useMemo(() => {
    const groups = JSON.parse(JSON.stringify(BASE_NAV_GROUPS)) as NavGroup[];
    
    // Replace original icons that JSON stringify lost
    groups.forEach((g, gIdx) => {
      g.items.forEach((item, iIdx) => {
        item.icon = BASE_NAV_GROUPS[gIdx].items[iIdx].icon;
        if (item.children) {
          item.children.forEach((child, cIdx) => {
            child.icon = BASE_NAV_GROUPS[gIdx].items[iIdx].children![cIdx].icon;
          });
        }
      });
    });

    const catalogGroup = groups.find(g => g.title === "Catalog");
    if (catalogGroup) {
      const productsItem = catalogGroup.items.find(i => i.label === "Products");
      if (productsItem && productCategories) {
        productsItem.children = productCategories.map(cat => ({
          icon: Tags,
          label: cat.name,
          path: `/products?category=${cat.id}`,
          roles: ["admin", "staff"]
        }));
      }
    }
    return groups;
  }, [productCategories]);
  
  const [internalOpen, setInternalOpen] = useState(false);
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const mobileOpen = mobileOpenProp ?? internalOpen;
  
  const setMobileOpen = (v: boolean) => {
    if (onMobileOpenChange) onMobileOpenChange(v);
    else setInternalOpen(v);
  };

  const toggleCollapse = () => {
    if (onCollapsedChange) onCollapsedChange(!collapsed);
  };

  const toggleSubmenu = (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenus(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const initials = user?.email?.slice(0, 2).toUpperCase() || "??";
  const businessName = active?.business_name || "DokanOS";
  const businessLogo = active?.logo_url || "";
  const hasMultiple = switcherList.length > 1;

  const BrandBlock = (
    <div className={`flex items-center gap-2 min-w-0 ${collapsed ? "justify-center w-full px-0" : ""}`}>
      {businessLogo ? (
        <img src={businessLogo} alt={businessName} className="h-8 w-8 rounded-md object-contain bg-white p-0.5 border border-border/30 shrink-0" />
      ) : (
        <img src={dokanosIcon} alt={businessName} className="h-8 w-8 rounded-md object-contain shrink-0" />
      )}
      {!collapsed && (
        <>
          <span className="font-heading text-sm font-semibold text-foreground truncate">{businessName}</span>
          {hasMultiple && <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />}
        </>
      )}
    </div>
  );

  const sidebar = (
    <div className="flex h-full flex-col backdrop-blur-xl bg-sidebar/70">
      <div className="flex h-14 items-center justify-between border-b border-border/30 px-4">
        {hasMultiple ? (
          <DropdownMenu>
            <DropdownMenuTrigger className={`flex-1 min-w-0 text-left rounded-md hover:bg-secondary/60 py-1 transition-colors ${collapsed ? "" : "px-2 -mx-2"}`}>
              {BrandBlock}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 bg-sidebar/90 backdrop-blur-md border-border/30">
              <DropdownMenuLabel>Switch business</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border/30" />
              {switcherList.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setActive(p.id)} className="gap-2">
                  {p.logo_url ? (
                    <img src={p.logo_url} alt="" className="h-5 w-5 rounded object-contain bg-white p-0.5 border border-border/30" />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                      {p.business_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="flex-1 truncate">{p.business_name}</span>
                  {active?.id === p.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
              {brands.length > 0 && (
                <>
                  <DropdownMenuSeparator className="bg-border/30" />
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                    {brands.length} brand{brands.length === 1 ? "" : "s"} · {switcherList.length === 1 ? "configure in Stores" : "manage in Stores"}
                  </DropdownMenuLabel>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          BrandBlock
        )}
        <button className="lg:hidden text-muted-foreground ml-2 shrink-0 p-1 rounded-md hover:bg-secondary/50" onClick={() => setMobileOpen(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col custom-scrollbar">
        {/* Search hint */}
        <div className={`p-3 ${collapsed ? "px-2" : "px-4"}`}>
          <button
            onClick={() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true })); setMobileOpen(false); }}
            className={`flex items-center rounded-md border border-border/30 bg-secondary/30 text-xs text-muted-foreground hover:text-foreground transition-colors hover:border-primary/50 group ${collapsed ? "w-10 h-10 justify-center p-0 mx-auto" : "w-full gap-2 px-3 py-2"}`}
            title="Search (⌘K)"
          >
            <Search className="h-4 w-4 group-hover:text-primary transition-colors" />
            {!collapsed && (
              <>
                <span>Search...</span>
                <kbd className="ml-auto hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/30 bg-muted/50 px-1.5 text-[10px] font-mono text-muted-foreground">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        <TooltipProvider delayDuration={0}>
          <nav className="flex-1 space-y-4 px-3 pb-4">
            {navGroups.map((group) => {
              const groupItems = group.items.filter(item => role && item.roles.includes(role));
              if (groupItems.length === 0) return null;

              return (
                <div key={group.title} className="space-y-1">
                  {!collapsed && (
                    <h4 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
                      {group.title}
                    </h4>
                  )}
                  {groupItems.map((item) => {
                    const children = item.children?.filter((c) => role && c.roles.includes(role)) || [];
                    
                    const isItemPathActive = (path: string) => {
                      const [basePath, query] = path.split('?');
                      if (location.pathname !== basePath) return false;
                      if (!query) return true; // Just checking base path if no query in item
                      
                      const urlSearchParams = new URLSearchParams(query);
                      let matches = true;
                      urlSearchParams.forEach((val, key) => {
                        if (searchParams.get(key) !== val) matches = false;
                      });
                      return matches;
                    };

                    const isMainActive = isItemPathActive(item.path) || (item.path !== '/' && location.pathname.startsWith(`${item.path}/`));
                    const isAnyChildActive = children.some(c => isItemPathActive(c.path));
                    const isActive = isMainActive || isAnyChildActive;
                    
                    const hasChildren = children.length > 0;
                    const isOpen = openMenus[item.path] || (isActive && !collapsed); // auto open if active

                    const handleItemClick = (e: React.MouseEvent) => {
                      if (hasChildren && !collapsed) {
                        e.preventDefault();
                        navigate(item.path);
                        if (!openMenus[item.path]) {
                           setOpenMenus(prev => ({ ...prev, [item.path]: true }));
                        }
                      } else {
                        setMobileOpen(false);
                      }
                    };

                    const LinkContent = (
                      <Link
                        to={item.path}
                        onClick={handleItemClick}
                        className={`group flex items-center rounded-md text-sm font-medium transition-all duration-200 ${
                          collapsed ? "justify-center h-10 w-10 mx-auto" : "gap-3 px-3 py-2"
                        } ${
                          isActive
                            ? "bg-primary/20 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-foreground border border-transparent hover:border-border/30"
                        }`}
                      >
                        <item.icon className={`shrink-0 ${collapsed ? "h-5 w-5" : "h-4 w-4"} ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground transition-colors"}`} />
                        {!collapsed && <span className="flex-1">{item.label}</span>}
                        {!collapsed && hasChildren && (
                          <div 
                            onClick={(e) => toggleSubmenu(item.path, e)}
                            className="p-1 -mr-2 rounded-md hover:bg-secondary/50 transition-colors"
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4 opacity-70" /> : <ChevronRight className="h-4 w-4 opacity-70" />}
                          </div>
                        )}
                        {!collapsed && isActive && (
                          <div className="absolute left-0 w-1 h-8 bg-primary rounded-r-md opacity-0 lg:opacity-100 shadow-[0_0_10px_var(--primary)]" />
                        )}
                      </Link>
                    );

                    return (
                      <div key={item.path} className="relative">
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>{LinkContent}</TooltipTrigger>
                            <TooltipContent side="right" className="font-medium bg-popover/90 backdrop-blur-md border-border/30">
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          LinkContent
                        )}

                        {!collapsed && hasChildren && isOpen && (
                          <div className="mt-1 ml-4 space-y-1 border-l border-border/30 pl-2 overflow-hidden animate-in slide-in-from-top-2 opacity-100 fade-in duration-200">
                            {children.map((child) => {
                              const childActive = isItemPathActive(child.path);
                              return (
                                <Link
                                  key={child.path}
                                  to={child.path}
                                  onClick={() => setMobileOpen(false)}
                                  className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-xs transition-all ${
                                    childActive
                                      ? "bg-primary/10 text-primary font-medium"
                                      : "text-sidebar-foreground hover:bg-sidebar-accent/30 hover:text-foreground"
                                  }`}
                                >
                                  <child.icon className={`h-3.5 w-3.5 ${childActive ? "text-primary shadow-[0_0_5px_var(--primary)] rounded-full" : "text-muted-foreground"}`} />
                                  {child.label}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </TooltipProvider>
      </div>

      <div className="border-t border-border/30 p-3 bg-secondary/10">
        <div className={`flex items-center ${collapsed ? "flex-col gap-3 justify-center" : "gap-3 px-1"}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary ring-1 ring-primary/30 shadow-[0_0_10px_rgba(var(--primary),0.2)]">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user?.email}</p>
              <p className="truncate text-xs capitalize text-muted-foreground">{role || "—"}</p>
            </div>
          )}
          
          <div className={`flex ${collapsed ? "flex-col gap-2" : "gap-1 shrink-0"}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50" onClick={toggleTheme} title="Toggle Theme">
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50" onClick={signOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      {/* Desktop Collapse Toggle */}
      <div className="hidden lg:flex absolute -right-3 top-16 z-50">
        <Button 
          variant="secondary" 
          size="icon" 
          className="h-6 w-6 rounded-full border border-border/50 shadow-[0_0_10px_rgba(0,0,0,0.2)] ring-1 ring-background bg-sidebar hover:bg-secondary transition-colors" 
          onClick={toggleCollapse}
        >
          {collapsed ? <PanelLeftOpen className="h-3 w-3 text-muted-foreground" /> : <PanelLeftClose className="h-3 w-3 text-muted-foreground" />}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm transition-opacity lg:hidden" 
          onClick={() => setMobileOpen(false)} 
        />
      )}

      {/* Mobile sidebar (always expanded) */}
      <aside className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-border/30 bg-sidebar/80 backdrop-blur-xl transition-transform duration-300 ease-in-out lg:hidden ${mobileOpen ? "translate-x-0 shadow-[0_0_30px_rgba(0,0,0,0.5)]" : "-translate-x-full"}`}>
        {sidebar}
      </aside>

      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex fixed left-0 top-0 z-40 h-screen flex-col border-r border-border/30 bg-sidebar/80 backdrop-blur-xl transition-[width] duration-300 ease-in-out ${collapsed ? "w-16" : "w-64"}`}>
        {sidebar}
      </aside>
    </>
  );
};

export default AppSidebar;
