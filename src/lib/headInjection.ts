/**
 * Rewrites the static `index.html` head for one route.
 *
 * Kept apart from `middleware.ts` so it is a pure string-to-string function and
 * therefore testable without an edge runtime or a network. The middleware does
 * the fetching and the route matching; this does the surgery.
 *
 * Note what it does NOT do: invent a canonical for a route it was given no
 * meta for. Returning the input unchanged is always the safe answer — a page
 * with no canonical is treated as its own canonical, which is correct, whereas
 * a guessed one is how every route ended up claiming to be the homepage.
 */
import type { RouteMeta } from "./routeMeta";
import { canonicalUrl } from "./routeMeta";

/** Minimal HTML-attribute escaping for values that go inside double quotes. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal escaping for text between tags — `<title>` takes no attributes. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Returns `html` with this route's title, description, OG tags and canonical.
 *
 * `meta` of null returns the input untouched — that is the fallback path when a
 * lookup failed or the route is one we do not model. Callers rely on this: a
 * missing meta tag must never turn into a failed page load.
 */
export function injectHead(html: string, meta: RouteMeta | null): string {
  if (!meta) return html;

  const title = escapeText(meta.title);
  const description = escapeAttr(meta.description);
  const canonical = escapeAttr(canonicalUrl(meta.canonicalPath));

  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);

  out = replaceMeta(out, "name", "description", description);
  // Open Graph matters for the link previews outreach emails and shares produce,
  // and it has the same too-late problem as the rest of the head.
  out = replaceMeta(out, "property", "og:title", title);
  out = replaceMeta(out, "property", "og:description", description);
  out = replaceMeta(out, "property", "og:url", canonical);

  // Canonical is always an insert, never a replace: index.html deliberately has
  // none. Placed immediately before </head> so it survives any head reordering.
  out = out.replace(
    /<\/head>/i,
    `  <link rel="canonical" href="${canonical}" />\n  </head>`,
  );

  return out;
}

/**
 * Replaces an existing meta tag's `content`, or inserts the tag when absent.
 *
 * Inserting rather than skipping matters for the OG tags: `index.html` carries
 * some but not all of them, and a route-specific `og:url` that silently did not
 * appear would be the same class of invisible failure as the canonical bug.
 */
function replaceMeta(html: string, attr: "name" | "property", key: string, content: string): string {
  const existing = new RegExp(`<meta\\s+${attr}=["']${escapeRegex(key)}["'][^>]*>`, "i");
  const tag = `<meta ${attr}="${key}" content="${content}">`;
  if (existing.test(html)) return html.replace(existing, tag);
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
