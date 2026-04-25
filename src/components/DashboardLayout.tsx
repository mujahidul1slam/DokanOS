import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";
import QuickShortcuts from "./QuickShortcuts";
import GlobalSyncIndicator from "./integrations/GlobalSyncIndicator";

const DashboardLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen">
    <AppSidebar />
    <main className="flex-1 overflow-auto lg:ml-60">
      <div className="p-4 pt-16 lg:p-6 lg:pt-6">
        <QuickShortcuts />
        {children}
      </div>
    </main>
    <GlobalSyncIndicator />
  </div>
);

export default DashboardLayout;
