import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { BusinessProfileProvider } from "@/hooks/useBusinessProfile";
import { BusinessContextProvider } from "@/hooks/useBusinessContext";
import { ThemeProvider } from "@/hooks/useTheme";
import ErrorBoundary from "@/components/ErrorBoundary";
import PermissionGuard from "@/components/PermissionGuard";
import CommandPalette from "@/components/CommandPalette";
import DashboardLayout from "./components/DashboardLayout";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import { Loader2 } from "lucide-react";
import { markAppLoaded } from "@/lib/chunkRecovery";
import { detectBrand, detectBrandAsync } from "@/storefront/lib/brand";

const StorefrontApp = lazy(() => import("@/storefront/StorefrontApp"));

// Lazy-load all authenticated pages so initial bundle stays small.
// Each page becomes its own JS chunk loaded on-demand.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const Customers = lazy(() => import("./pages/Customers"));
const Products = lazy(() => import("./pages/Products"));
const POS = lazy(() => import("./pages/POS"));
const PosReports = lazy(() => import("./pages/PosReports"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Integrations = lazy(() => import("./pages/Integrations"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));
const StorefrontsPage = lazy(() => import("./pages/StorefrontsPage"));
const StorefrontPreviewPage = lazy(() => import("./pages/StorefrontPreviewPage"));
const StorefrontPreviewSurface = lazy(() => import("./pages/StorefrontPreviewSurface"));

// Preview router: `?surface=` param or `_`-prefixed pageSlugs go to the
// direct-render StorefrontPreviewSurface (no StorefrontApp catch-all);
// plain pageSlugs (home, about…) go through the existing StorefrontPreviewPage.
const StorefrontPreview = lazy(() =>
  Promise.all([import("./pages/StorefrontPreviewPage"), import("./pages/StorefrontPreviewSurface")]).then(
    ([Page, Surface]) => ({
      default: function StorefrontPreviewRouter() {
        const params = new URLSearchParams(window.location.search);
        const pageSlug = window.location.pathname.split("/").pop() || "";
        return params.get("surface") || pageSlug.startsWith("_") ? <Surface.default /> : <Page.default />;
      },
    }),
  ),
);
const StorefrontAdminShell = lazy(() => import("@/components/storefront-admin/StorefrontAdminShell"));
const StorefrontOverview = lazy(() => import("@/components/storefront-admin/AdminPages").then(m => ({ default: m.StorefrontOverview })));
const ThemeGallery = lazy(() => import("@/components/storefront-admin/AdminPages").then(m => ({ default: m.ThemeGallery })));
const AdminHelp = lazy(() => import("@/components/storefront-admin/AdminPages").then(m => ({ default: m.AdminHelp })));
const StorefrontAdminEditor = lazy(() => import("@/components/storefront-admin/StorefrontAdminEditor"));
const StoresHub = lazy(() => import("./pages/StoresHub"));
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

// Shared admin route wrapper: PermissionGuard + TWO Suspense boundaries.
// The admin shell routes live outside DashboardLayout, so without this wrapper
// their lazy() components suspend with no boundary above them — React 18 then
// throws Minified error #426 ("component suspended while responding to
// synchronous input") on every navigation. Outer boundary covers the lazy
// shell itself; inner boundary keeps the shell mounted while surface chunks
// load (sidebar doesn't flash).
function StorefrontAdminRoute({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard permission="storefronts.view">
      <Suspense fallback={<FullScreenLoader label="Loading…" />}>
        <StorefrontAdminShell>
          <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </StorefrontAdminShell>
      </Suspense>
    </PermissionGuard>
  );
}

const AppRoutes = () => {
  const { user, loading } = useAuth();

  // Clear the chunk-recovery guard only AFTER the app has rendered for a few
  // seconds without a chunk failure. Clearing during render — before lazy
  // chunks resolve — resets the guard too early and causes an infinite
  // reload loop when a chunk keeps failing.
  useEffect(() => {
    const t = setTimeout(() => markAppLoaded(), 5_000);
    return () => clearTimeout(t);
  }, []);

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
    <Routes>
      {/* Preview routes — FULL-BLEED (no DashboardLayout chrome around the storefront page).
          Suspense-wrapped: StorefrontPreview is lazy. */}
      <Route path="/storefronts/preview/:slug/:pageSlug" element={<PermissionGuard permission="storefronts.view"><Suspense fallback={<FullScreenLoader label="Loading…" />}><StorefrontPreview /></Suspense></PermissionGuard>} />
      <Route path="/storefronts/preview/:slug" element={<PermissionGuard permission="storefronts.view"><Suspense fallback={<FullScreenLoader label="Loading…" />}><StorefrontPreview /></Suspense></PermissionGuard>} />

      {/* Storefront admin shell routes — FULL-BLEED, outside DashboardLayout.
          StorefrontAdminShell renders its own sidebar; AppSidebar never shows here.
          All wrapped in StorefrontAdminRoute (PermissionGuard + Suspense — see above). */}
      <Route path="/storefronts/:slug/admin" element={<StorefrontAdminRoute><Navigate to="dashboard" replace /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/dashboard" element={<StorefrontAdminRoute><StorefrontOverview /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/theme" element={<StorefrontAdminRoute><ThemeGallery /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/builder" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="builder" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/pages" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="pages" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/collections" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="collections" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/products" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="products" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/identity" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="identity" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/header-footer" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="header-footer" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/product-page" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="product-page" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/product-card" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="product-card" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/shop-page" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="shop-page" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/animations" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="animations" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/delivery" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="delivery" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/payments" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="payments" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/domains" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="domains" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/policies" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="policies" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/settings" element={<StorefrontAdminRoute><StorefrontAdminEditor surface="settings" /></StorefrontAdminRoute>} />
      <Route path="/storefronts/:slug/admin/help" element={<StorefrontAdminRoute><AdminHelp /></StorefrontAdminRoute>} />

      {/* Standard dashboard routes */}
      <Route path="*" element={
        <DashboardLayout>
          <CommandPalette />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<PermissionGuard permission="dashboard.view"><Dashboard /></PermissionGuard>} />
              <Route path="/orders" element={<PermissionGuard permission="orders.view"><Orders /></PermissionGuard>} />
              <Route path="/customers" element={<PermissionGuard permission="customers.view"><Customers /></PermissionGuard>} />
              <Route path="/products" element={<PermissionGuard permission="products.view"><Products /></PermissionGuard>} />
              <Route path="/pos" element={<PermissionGuard permission="pos.use"><POS /></PermissionGuard>} />
              <Route path="/pos/reports" element={<PermissionGuard permission="analytics.view"><PosReports /></PermissionGuard>} />
              <Route path="/analytics" element={<PermissionGuard permission="analytics.view"><Analytics /></PermissionGuard>} />
              <Route path="/integrations" element={<PermissionGuard permission="integrations.view"><Integrations /></PermissionGuard>} />
              <Route path="/settings" element={<PermissionGuard permission="settings.view"><SettingsPage /></PermissionGuard>} />
              <Route path="/team" element={<PermissionGuard permission="team.view"><TeamManagement /></PermissionGuard>} />
              <Route path="/stores" element={<PermissionGuard permission="dashboard.view"><StoresHub /></PermissionGuard>} />
              <Route path="/storefronts" element={<PermissionGuard permission="storefronts.view"><StorefrontsPage /></PermissionGuard>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </DashboardLayout>
      } />
    </Routes>
  );
};

const Root = () => {
  // Phase 1: synchronous check (path / query param)
  const syncBrand = detectBrand();

  // Phase 2: async check (hostname / subdomain / custom domain)
  const [asyncBrand, setAsyncBrand] = useState<string | null | undefined>(
    syncBrand ? syncBrand : undefined, // undefined = still loading
  );

  useEffect(() => {
    if (syncBrand) {
      setAsyncBrand(syncBrand);
      return;
    }
    detectBrandAsync().then((b) => setAsyncBrand(b ?? null));
  }, [syncBrand]);

  // Still resolving async brand detection
  if (asyncBrand === undefined) {
    return <FullScreenLoader label="Loading…" />;
  }

  const brand = asyncBrand;

  if (brand) {
    const basePath = `/storefront/${brand}`;
    return (
      <Suspense fallback={<FullScreenLoader label="Loading…" />}>
        <StorefrontApp brand={brand} basePath={basePath} />
      </Suspense>
    );
  }
  return (
    <AuthProvider>
      <PermissionsProvider>
        <BusinessContextProvider>
          <BusinessProfileProvider>
            <AppRoutes />
          </BusinessProfileProvider>
        </BusinessContextProvider>
      </PermissionsProvider>
    </AuthProvider>
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
            <Root />
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
