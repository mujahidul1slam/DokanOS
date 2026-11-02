import React from "react";

export interface OrganizationJsonLdProps {
  name: string;
  url: string;
  logo?: string | null;
}

export function OrganizationJsonLd({ name, url, logo }: OrganizationJsonLdProps) {
  const schema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url,
  };
  if (logo) {
    schema.logo = logo;
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export interface ProductJsonLdProps {
  name: string;
  description?: string | null;
  image?: string | null;
  price: number;
  currency?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  url?: string;
}

export function ProductJsonLd({
  name,
  description,
  image,
  price,
  currency = "BDT",
  manage_stock = false,
  stock_quantity = 0,
  url,
}: ProductJsonLdProps) {
  // Fact 13 / M2: gate availability strictly on manage_stock && stock_quantity <= 0 (ignore stock_status)
  const isOutOfStock = manage_stock && stock_quantity <= 0;
  const availability = isOutOfStock
    ? "https://schema.org/OutOfStock"
    : "https://schema.org/InStock";

  const schema: Record<string, any> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    offers: {
      "@type": "Offer",
      price: price.toString(),
      priceCurrency: currency,
      availability,
    },
  };

  if (description) schema.description = description;
  if (image) schema.image = [image];
  if (url) schema.offers.url = url;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface BreadcrumbListJsonLdProps {
  items: BreadcrumbItem[];
}

export function BreadcrumbListJsonLd({ items }: BreadcrumbListJsonLdProps) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: it.name,
      item: it.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
