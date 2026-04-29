import { ReactNode, useState } from "react";
import AppSidebar from "./AppSidebar";
import BottomNav from "./BottomNav";
import QuickShortcuts from "./QuickShortcuts";
import GlobalSyncIndicator from "./integrations/GlobalSyncIndicator";

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <AppSidebar mobileOpen={mobileMenuOpen} onMobileOpenChange={setMobileMenuOpen} />
      <main className="flex-1 overflow-auto lg:ml-60 pb-16 lg:pb-0">
        <div className="p-4 lg:p-6">
          <QuickShortcuts />
          {children}
        </div>
      </main>
      <BottomNav onMenuClick={() => setMobileMenuOpen(true)} />
      <GlobalSyncIndicator />
    </div>
  );
};

export default DashboardLayout;
