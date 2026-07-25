import { useEffect } from "react";
import { SITE_URL, OG_IMAGE, SITE_NAME } from "@/lib/constants";

interface PageMetaProps {
  title: string;
  description: string;
  canonicalPath?: string;
  ogType?: string;
  ogImage?: string;
  noIndex?: boolean;
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (el) {
    el.setAttribute("content", content);
  } else {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    el.content = content;
    document.head.appendChild(el);
  }
}

function setCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (el) {
    el.href = href;
  } else {
    el = document.createElement("link");
    el.rel = "canonical";
    el.href = href;
    document.head.appendChild(el);
  }
}

export function PageMeta({ title, description, canonicalPath, ogType = "website", ogImage, noIndex }: PageMetaProps) {
  useEffect(() => {
    document.title = title;

    // Core meta
    setMeta("description", description);

    // Canonical
    const canonical = canonicalPath
      ? `${SITE_URL}${canonicalPath}`
      : `${SITE_URL}${window.location.pathname}`;
    setCanonical(canonical);

    // Open Graph
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:type", ogType, "property");
    setMeta("og:url", canonical, "property");
    setMeta("og:image", ogImage || OG_IMAGE, "property");
    setMeta("og:site_name", SITE_NAME, "property");

    // Twitter
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description.slice(0, 200));
    setMeta("twitter:image", ogImage || OG_IMAGE);

    // Robots
    if (noIndex) {
      setMeta("robots", "noindex, nofollow");
    } else {
      setMeta("robots", "index, follow");
    }
  }, [title, description, canonicalPath, ogType, ogImage, noIndex]);

  return null;
}
