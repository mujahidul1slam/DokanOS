import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

const DashboardLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen">
    <AppSidebar />
    <main className="flex-1 overflow-auto lg:ml-60">
      <div className="p-4 pt-16 lg:p-6 lg:pt-6">
        {children}
      </div>
    </main>
  </div>
);

export default DashboardLayout;
