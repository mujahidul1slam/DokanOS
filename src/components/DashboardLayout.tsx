import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

const DashboardLayout = () => (
  <div className="flex min-h-screen">
    <AppSidebar />
    <main className="ml-60 flex-1 overflow-auto">
      <div className="p-6">
        <Outlet />
      </div>
    </main>
  </div>
);

export default DashboardLayout;
