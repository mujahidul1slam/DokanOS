import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { BusinessProfileProvider } from "@/hooks/useBusinessProfile";
import { ThemeProvider } from "@/hooks/useTheme";
import ErrorBoundary from "@/components/ErrorBoundary";
import PermissionGuard from "@/components/PermissionGuard";
import CommandPalette from "@/components/CommandPalette";
import DashboardLayout from "./components/DashboardLayout";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import { Loader2 } from "lucide-react";

// Lazy-load all authenticated pages so initial bundle stays small.
// Each page becomes its own JS chunk loaded on-demand.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const PreOrders = lazy(() => import("./pages/PreOrders"));
const Customers = lazy(() => import("./pages/Customers"));
const Products = lazy(() => import("./pages/Products"));
const POS = lazy(() => import("./pages/POS"));
const PosReports = lazy(() => import("./pages/PosReports"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Integrations = lazy(() => import("./pages/Integrations"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Tuned QueryClient: avoid noisy refetches that hammer Supabase egress on free plan.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — most lists don't need second-by-second freshness
      gcTime: 5 * 60_000, // keep cached data 5 min
      refetchOnWindowFocus: false,
      refetchOnReconnect: "always",
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

const FullScreenLoader = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="text-center space-y-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  </div>
);

const PageFallback = () => (
  <div className="flex h-[60vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader label="Loading DokanOS..." />;

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
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<PermissionGuard permission="dashboard.view"><Dashboard /></PermissionGuard>} />
          <Route path="/orders" element={<PermissionGuard permission="orders.view"><Orders /></PermissionGuard>} />
          <Route path="/pre-orders" element={<PermissionGuard permission="preorders.view"><PreOrders /></PermissionGuard>} />
          <Route path="/customers" element={<PermissionGuard permission="customers.view"><Customers /></PermissionGuard>} />
          <Route path="/products" element={<PermissionGuard permission="products.view"><Products /></PermissionGuard>} />
          <Route path="/pos" element={<PermissionGuard permission="pos.use"><POS /></PermissionGuard>} />
          <Route path="/pos/reports" element={<PermissionGuard permission="analytics.view"><PosReports /></PermissionGuard>} />
          <Route path="/analytics" element={<PermissionGuard permission="analytics.view"><Analytics /></PermissionGuard>} />
          <Route path="/integrations" element={<PermissionGuard permission="integrations.view"><Integrations /></PermissionGuard>} />
          <Route path="/settings" element={<PermissionGuard permission="settings.view"><SettingsPage /></PermissionGuard>} />
          <Route path="/team" element={<PermissionGuard permission="team.view"><TeamManagement /></PermissionGuard>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
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
                <BusinessProfileProvider>
                  <AppRoutes />
                </BusinessProfileProvider>
              </PermissionsProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
