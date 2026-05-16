import { useBrand } from "../BrandContext";

export default function Contact() {
  const { storefront } = useBrand();
  return (
    <div className="max-w-xl mx-auto px-4 py-24">
      <div className="text-xs uppercase tracking-[0.25em] text-primary mb-4">Contact</div>
      <h1 className="sf-display text-5xl mb-10">Say hello</h1>
      <div className="sf-glass p-8 space-y-4">
        {storefront.contact_email && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Email</div>
            <a href={`mailto:${storefront.contact_email}`} className="text-lg hover:text-primary">{storefront.contact_email}</a>
          </div>
        )}
        {storefront.contact_phone && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Phone</div>
            <a href={`tel:${storefront.contact_phone}`} className="text-lg hover:text-primary">{storefront.contact_phone}</a>
          </div>
        )}
        {!storefront.contact_email && !storefront.contact_phone && (
          <p className="text-muted-foreground">Contact details coming soon.</p>
        )}
      </div>
    </div>
  );
}
