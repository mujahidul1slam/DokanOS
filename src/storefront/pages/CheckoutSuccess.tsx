import { Link, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { useBrand } from "../BrandContext";
import { brandBasePath } from "../lib/brand";

export default function CheckoutSuccess() {
  const { orderNumber } = useParams();
  const { brand } = useBrand();
  return (
    <div className="max-w-2xl mx-auto px-4 py-32 text-center">
      <div className="sf-glass p-12">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary text-primary-foreground mb-8">
          <Check className="h-8 w-8" />
        </div>
        <h1 className="sf-display text-4xl mb-4">Thank you</h1>
        <p className="text-muted-foreground mb-2">Your order has been placed.</p>
        <p className="sf-display text-2xl mb-8">#{orderNumber}</p>
        <p className="text-sm text-muted-foreground mb-10">
          We'll contact you shortly to confirm the order and arrange delivery.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to={`${brandBasePath(brand)}/shop`} className="px-7 py-3 rounded-full border border-border text-sm uppercase tracking-widest hover:border-primary transition">
            Continue shopping
          </Link>
          <Link to={`${brandBasePath(brand)}/track`} className="px-7 py-3 rounded-full bg-primary text-primary-foreground text-sm uppercase tracking-widest">
            Track order
          </Link>
        </div>
      </div>
    </div>
  );
}
