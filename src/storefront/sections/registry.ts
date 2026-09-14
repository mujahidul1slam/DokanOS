import type { ComponentType } from "react";
import Hero from "./Hero";
import FeaturedProducts from "./FeaturedProducts";
import ProductGrid from "./ProductGrid";
import CollectionGrid from "./CollectionGrid";
import RichText from "./RichText";
import ImageBanner from "./ImageBanner";
import Gallery from "./Gallery";
import Testimonials from "./Testimonials";
import Faq from "./Faq";

/**
 * Section component registry (plan §4.2) — the single source of truth for
 * section types. `adminFields` is a declarative form schema so ONE generic
 * prop form serves every type (PagesTab). `validate` runs on admin save; the
 * renderer is defensively no-op-safe (unknown type / bad props → nothing).
 *
 * Deferred types (documented for discoverability, NOT registered — plan §12/M6):
 *  - contact-form  → needs an anon-writable messages table + moderation inbox +
 *    anti-spam; deferred with notifications (P1 #11).
 *  - newsletter    → no capture backend until the analytics event pipeline
 *    (P1 #9); consent/compliance story required. Deferred with analytics.
 */

export type SectionType =
  | "hero"
  | "featured-products"
  | "product-grid"
  | "collection-grid"
  | "rich-text"
  | "image-banner"
  | "gallery"
  | "testimonials"
  | "faq";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "toggle"
  | "select"
  | "strings-list"
  | "image-url"
  | "list-of-objects";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** For list-of-objects: the form schema of each entry. */
  itemFields?: FieldDef[];
  itemLabelKey?: string;
  min?: number;
  max?: number;
}

export interface SectionProps {
  [key: string]: any;
}

export interface SectionDef {
  adminLabel: string;
  component: ComponentType<{ props: SectionProps }>;
  defaultProps: SectionProps;
  /** Returns user-facing problems; empty array = valid. Runs on admin save. */
  validate: (props: SectionProps) => string[];
  adminFields: FieldDef[];
}

const columnsField: FieldDef = {
  key: "columns",
  label: "Columns",
  type: "select",
  options: [
    { value: "2", label: "2" },
    { value: "3", label: "3" },
    { value: "4", label: "4" },
  ],
};

const titleField: FieldDef = { key: "title", label: "Title", type: "text" };

export const registry: Record<string, SectionDef> = {
  hero: {
    adminLabel: "Hero",
    component: Hero,
    defaultProps: { title: "", subtitle: "", image_url: "", align: "center", overlay: 30 },
    validate: (p) => (p?.title ? [] : ["Hero needs a title"]),
    adminFields: [
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Subtitle", type: "textarea" },
      { key: "image_url", label: "Background image", type: "image-url" },
      { key: "cta_label", label: "Button label (optional)", type: "text" },
      { key: "cta_href", label: "Button link (optional)", type: "text", placeholder: "/shop" },
      {
        key: "align", label: "Alignment", type: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
        ],
      },
      { key: "overlay", label: "Image overlay (0–100)", type: "number", min: 0, max: 100 },
    ],
  },
  "featured-products": {
    adminLabel: "Featured products",
    component: FeaturedProducts,
    defaultProps: { title: "Featured", limit: 8, columns: 4 },
    validate: (p) => {
      const errs: string[] = [];
      const limit = Number(p?.limit ?? 8);
      if (!Number.isFinite(limit) || limit < 1 || limit > 12) errs.push("Limit must be 1–12");
      const cols = Number(p?.columns ?? 4);
      if (![2, 3, 4].includes(cols)) errs.push("Columns must be 2–4");
      return errs;
    },
    adminFields: [
      titleField,
      { key: "limit", label: "Max products (1–12)", type: "number", min: 1, max: 12 },
      columnsField,
    ],
  },
  "product-grid": {
    adminLabel: "Product grid",
    component: ProductGrid,
    defaultProps: { title: "", product_ids: [], columns: 4 },
    validate: (p) => {
      const errs: string[] = [];
      if (!Array.isArray(p?.product_ids) || p.product_ids.length === 0) errs.push("Pick at least one product");
      const cols = Number(p?.columns ?? 4);
      if (![2, 3, 4].includes(cols)) errs.push("Columns must be 2–4");
      return errs;
    },
    adminFields: [titleField, { key: "product_ids", label: "Products", type: "strings-list" }, columnsField],
  },
  "collection-grid": {
    adminLabel: "Collection grid",
    component: CollectionGrid,
    defaultProps: { title: "Collections", collection_ids: [], columns: 3 },
    validate: (p) => {
      const errs: string[] = [];
      if (!Array.isArray(p?.collection_ids) || p.collection_ids.length === 0) errs.push("Pick at least one collection");
      const cols = Number(p?.columns ?? 3);
      if (![2, 3, 4].includes(cols)) errs.push("Columns must be 2–4");
      return errs;
    },
    adminFields: [titleField, { key: "collection_ids", label: "Collections", type: "strings-list" }, columnsField],
  },
  "rich-text": {
    adminLabel: "Rich text",
    component: RichText,
    defaultProps: { title: "", markdown: "" },
    validate: (p) => (typeof p?.markdown === "string" && p.markdown.trim() ? [] : ["Rich text needs content"]),
    adminFields: [titleField, { key: "markdown", label: "Content (markdown)", type: "textarea" }],
  },
  "image-banner": {
    adminLabel: "Image banner",
    component: ImageBanner,
    defaultProps: { image_url: "", href: "", height: "m", overlay: 20 },
    validate: (p) => (p?.image_url ? [] : ["Banner needs an image"]),
    adminFields: [
      { key: "image_url", label: "Image", type: "image-url" },
      { key: "href", label: "Link (optional)", type: "text" },
      {
        key: "height", label: "Height", type: "select",
        options: [
          { value: "s", label: "Small" },
          { value: "m", label: "Medium" },
          { value: "l", label: "Large" },
        ],
      },
      { key: "overlay", label: "Overlay (0–100)", type: "number", min: 0, max: 100 },
    ],
  },
  gallery: {
    adminLabel: "Gallery",
    component: Gallery,
    defaultProps: { title: "", images: [] },
    validate: (p) =>
      Array.isArray(p?.images) && p.images.some((i: any) => i?.url) ? [] : ["Gallery needs at least one image"],
    adminFields: [
      titleField,
      {
        key: "images", label: "Images", type: "list-of-objects", itemLabelKey: "url",
        itemFields: [
          { key: "url", label: "Image URL", type: "image-url" },
          { key: "alt", label: "Alt text", type: "text" },
        ],
      },
    ],
  },
  testimonials: {
    adminLabel: "Testimonials",
    component: Testimonials,
    defaultProps: { title: "", items: [] },
    validate: (p) =>
      Array.isArray(p?.items) && p.items.some((i: any) => i?.quote) ? [] : ["Add at least one testimonial"],
    adminFields: [
      titleField,
      {
        key: "items", label: "Testimonials", type: "list-of-objects", itemLabelKey: "author",
        itemFields: [
          { key: "quote", label: "Quote", type: "textarea" },
          { key: "author", label: "Author", type: "text" },
          { key: "role", label: "Role (optional)", type: "text" },
        ],
      },
    ],
  },
  faq: {
    adminLabel: "FAQ",
    component: Faq,
    defaultProps: { title: "", items: [] },
    validate: (p) => (Array.isArray(p?.items) && p.items.some((i: any) => i?.q) ? [] : ["Add at least one question"]),
    adminFields: [
      titleField,
      {
        key: "items", label: "Questions", type: "list-of-objects", itemLabelKey: "q",
        itemFields: [
          { key: "q", label: "Question", type: "text" },
          { key: "a", label: "Answer", type: "textarea" },
        ],
      },
    ],
  },
};

export const DEFERRED_SECTION_TYPES: { type: string; reason: string }[] = [
  { type: "contact-form", reason: "Needs an anon-writable messages table + moderation + anti-spam; deferred to the notifications follow-up (P1 #11)." },
  { type: "newsletter", reason: "No capture backend until the analytics event pipeline (P1 #9); consent story required." },
];

