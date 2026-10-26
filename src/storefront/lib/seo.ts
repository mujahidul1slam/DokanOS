import { useEffect } from "react";

export interface PageMetaOptions {
  title?: string;
  description?: string;
  canonicalPath?: string;
  ogImageUrl?: string | null;
  ogType?: "website" | "product" | "article" | string;
}

function setMetaTag(attribute: "name" | "property", key: string, content: string | null | undefined) {
  let element = document.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!content) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setCanonical(href: string | null | undefined) {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!href) {
    if (link) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export function usePageMeta(meta: PageMetaOptions) {
  useEffect(() => {
    const prevTitle = document.title;

    if (meta.title) {
      document.title = meta.title;
    }

    if (meta.description !== undefined) {
      setMetaTag("name", "description", meta.description);
    }

    // Canonical link
    if (meta.canonicalPath) {
      const canonicalUrl = meta.canonicalPath.startsWith("http")
        ? meta.canonicalPath
        : typeof window !== "undefined"
        ? `${window.location.origin}${meta.canonicalPath.startsWith("/") ? "" : "/"}${meta.canonicalPath}`
        : meta.canonicalPath;
      setCanonical(canonicalUrl);
      setMetaTag("property", "og:url", canonicalUrl);
    }

    // OpenGraph
    if (meta.title) {
      setMetaTag("property", "og:title", meta.title);
      setMetaTag("name", "twitter:title", meta.title);
    }
    if (meta.description) {
      setMetaTag("property", "og:description", meta.description);
      setMetaTag("name", "twitter:description", meta.description);
    }
    setMetaTag("property", "og:type", meta.ogType || "website");

    if (meta.ogImageUrl) {
      setMetaTag("property", "og:image", meta.ogImageUrl);
      setMetaTag("name", "twitter:image", meta.ogImageUrl);
      setMetaTag("name", "twitter:card", "summary_large_image");
    } else {
      setMetaTag("property", "og:image", null);
      setMetaTag("name", "twitter:image", null);
      setMetaTag("name", "twitter:card", "summary");
    }

    return () => {
      document.title = prevTitle;
    };
  }, [meta.title, meta.description, meta.canonicalPath, meta.ogImageUrl, meta.ogType]);
}
