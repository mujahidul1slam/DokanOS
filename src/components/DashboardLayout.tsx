import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

const DashboardLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen">
    <AppSidebar />
    <main className="ml-60 flex-1 overflow-auto">
      <div className="p-6">
        {children}
      </div>
    </main>
  </div>
);

export default DashboardLayout;
