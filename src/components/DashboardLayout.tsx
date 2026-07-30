import { ReactNode, useState, useEffect } from "react";
import AppSidebar from "./AppSidebar";
import BottomNav from "./BottomNav";
import QuickShortcuts from "./QuickShortcuts";
import GlobalSyncIndicator from "./integrations/GlobalSyncIndicator";
import InstallBanner from "./InstallBanner";

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("dokanos-sidebar-collapsed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("dokanos-sidebar-collapsed", collapsed.toString());
  }, [collapsed]);

  return (
    <div 
      className="flex min-h-screen bg-background relative overflow-hidden transition-colors duration-500"
      style={{ backgroundImage: 'var(--app-bg-gradient)' }}
    >
      {/* Ambient glass glow */}
      <div className="absolute inset-0 bg-[var(--glass-bg)] pointer-events-none z-0" />
      
      <AppSidebar 
        mobileOpen={mobileMenuOpen} 
        onMobileOpenChange={setMobileMenuOpen} 
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
      
      <main className={`flex-1 overflow-auto pb-16 lg:pb-0 transition-[margin] duration-300 ease-in-out relative z-10 ${collapsed ? "lg:ml-16" : "lg:ml-64"}`}>
        <div className="p-4 lg:p-6">
          <QuickShortcuts />
          {children}
        </div>
      </main>
      <BottomNav onMenuClick={() => setMobileMenuOpen(true)} />
      <InstallBanner />
      <GlobalSyncIndicator />
    </div>
  );
};

export default DashboardLayout;
