import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { ThemeProvider } from "@/hooks/useTheme";
import ErrorBoundary from "@/components/ErrorBoundary";
import PermissionGuard from "@/components/PermissionGuard";
import CommandPalette from "@/components/CommandPalette";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import PreOrders from "./pages/PreOrders";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import POS from "./pages/POS";
import Analytics from "./pages/Analytics";
import Integrations from "./pages/Integrations";
import SettingsPage from "./pages/SettingsPage";
import TeamManagement from "./pages/TeamManagement";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading OmniSync...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <DashboardLayout>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<PermissionGuard permission="dashboard.view"><Dashboard /></PermissionGuard>} />
        <Route path="/orders" element={<PermissionGuard permission="orders.view"><Orders /></PermissionGuard>} />
        <Route path="/pre-orders" element={<PermissionGuard permission="preorders.view"><PreOrders /></PermissionGuard>} />
        <Route path="/customers" element={<PermissionGuard permission="customers.view"><Customers /></PermissionGuard>} />
        <Route path="/products" element={<PermissionGuard permission="products.view"><Products /></PermissionGuard>} />
        <Route path="/pos" element={<PermissionGuard permission="pos.use"><POS /></PermissionGuard>} />
        <Route path="/analytics" element={<PermissionGuard permission="analytics.view"><Analytics /></PermissionGuard>} />
        <Route path="/integrations" element={<PermissionGuard permission="integrations.view"><Integrations /></PermissionGuard>} />
        <Route path="/settings" element={<PermissionGuard permission="settings.view"><SettingsPage /></PermissionGuard>} />
        <Route path="/team" element={<PermissionGuard permission="team.view"><TeamManagement /></PermissionGuard>} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </DashboardLayout>
  );
};

const App = () => (
  <ErrorBoundary>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <PermissionsProvider>
                <AppRoutes />
              </PermissionsProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
