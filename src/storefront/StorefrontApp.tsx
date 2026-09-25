import { lazy, Suspense } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrandProvider } from "./BrandContext";
import type { BrandSlug, Storefront } from "./lib/brand";
import StorefrontLayout from "./components/StorefrontLayout";
import "./themes/storefront.css";

const Home = lazy(() => import("./pages/Home"));
const Shop = lazy(() => import("./pages/Shop"));
const Product = lazy(() => import("./pages/Product"));
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess"));
const Track = lazy(() => import("./pages/Track"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Policies = lazy(() => import("./pages/Policies"));
const CustomPage = lazy(() => import("./pages/CustomPage"));
const LandingPage = lazy(() => import("./pages/CustomPage"));
const Collection = lazy(() => import("./pages/Collection"));

const Fallback = () => (
  <div className="flex h-[60vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export default function StorefrontApp({
  brand,
  basePath,
  storefrontOverride,
  draftPageSlug,
}: {
  brand: BrandSlug;
  basePath: string;
  /** Admin preview: use this storefront row instead of the anon fetch. */
  storefrontOverride?: Storefront;
  /** Admin preview: render this page's working copy. */
  draftPageSlug?: string;
}) {
  return (
    <BrandProvider brand={brand} storefrontOverride={storefrontOverride} draftPageSlug={draftPageSlug}>
      <StorefrontLayout>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path={`${basePath}`} element={<Home />} />
            <Route path={`${basePath}/shop`} element={<Shop />} />
            <Route path={`${basePath}/product/:slug`} element={<Product />} />
            <Route path={`${basePath}/collections/:slug`} element={<Collection />} />
            <Route path={`${basePath}/cart`} element={<Cart />} />
            <Route path={`${basePath}/checkout`} element={<Checkout />} />
            <Route path={`${basePath}/checkout/success/:orderNumber`} element={<CheckoutSuccess />} />
            <Route path={`${basePath}/track`} element={<Track />} />
            <Route path={`${basePath}/about`} element={<About />} />
            <Route path={`${basePath}/contact`} element={<Contact />} />
            <Route path={`${basePath}/policies`} element={<Policies />} />
            <Route path={`${basePath}/pages/:slug`} element={<CustomPage />} />
{/* Landing pages (overhaul 3.3): standalone marketing pages — rendered
    WITHOUT the storefront chrome (no header/footer), like Bonik's creator. */}
<Route path={`${basePath}/lp/:slug`} element={<LandingPage standalone />} />
            <Route path="*" element={<Navigate to={basePath} replace />} />
          </Routes>
        </Suspense>
      </StorefrontLayout>
    </BrandProvider>
  );
}
