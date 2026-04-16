import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import ErrorBoundary from "@/components/ErrorBoundary";
import CommandPalette from "@/components/CommandPalette";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
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

const RoleGuard = ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) => {
  const { role } = useAuth();
  if (role && !allowedRoles.includes(role)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }
  return <>{children}</>;
};

const AppRoutes = () => {
  const { user, loading, role } = useAuth();

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

  // Viewer can only see Dashboard, Orders, Customers
  const viewerOnly = role === "viewer";

  return (
    <DashboardLayout>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/products" element={
          <RoleGuard allowedRoles={["admin", "staff"]}>
            <Products />
          </RoleGuard>
        } />
        <Route path="/pos" element={
          <RoleGuard allowedRoles={["admin", "staff"]}>
            <POS />
          </RoleGuard>
        } />
        <Route path="/analytics" element={
          <RoleGuard allowedRoles={["admin"]}>
            <Analytics />
          </RoleGuard>
        } />
        <Route path="/integrations" element={
          <RoleGuard allowedRoles={["admin"]}>
            <Integrations />
          </RoleGuard>
        } />
        <Route path="/settings" element={
          <RoleGuard allowedRoles={["admin"]}>
            <SettingsPage />
          </RoleGuard>
        } />
        <Route path="/team" element={
          <RoleGuard allowedRoles={["admin"]}>
            <TeamManagement />
          </RoleGuard>
        } />
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
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
