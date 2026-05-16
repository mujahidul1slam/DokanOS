import { lazy, Suspense } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { BrandProvider } from "./BrandContext";
import type { BrandSlug } from "./lib/brand";
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

const Fallback = () => (
  <div className="flex h-[60vh] items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

export default function StorefrontApp({ brand, basePath }: { brand: BrandSlug; basePath: string }) {
  return (
    <BrandProvider brand={brand}>
      <StorefrontLayout>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path={`${basePath}`} element={<Home />} />
            <Route path={`${basePath}/shop`} element={<Shop />} />
            <Route path={`${basePath}/product/:slug`} element={<Product />} />
            <Route path={`${basePath}/cart`} element={<Cart />} />
            <Route path={`${basePath}/checkout`} element={<Checkout />} />
            <Route path={`${basePath}/checkout/success/:orderNumber`} element={<CheckoutSuccess />} />
            <Route path={`${basePath}/track`} element={<Track />} />
            <Route path={`${basePath}/about`} element={<About />} />
            <Route path={`${basePath}/contact`} element={<Contact />} />
            <Route path="*" element={<Navigate to={basePath} replace />} />
          </Routes>
        </Suspense>
      </StorefrontLayout>
    </BrandProvider>
  );
}
