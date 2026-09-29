/**
 * The one place a route's head tags are decided.
 *
 * Why this exists rather than the strings living in each page component: the
 * same title, description and canonical now have to be produced twice — once
 * by the React page for a visitor navigating in the browser, and once by
 * `middleware.ts` for a crawler that never runs JS. Two copies of a string
 * drift, and this particular drift is invisible: the page looks right to a
 * human while search engines are told something else. That is the exact shape
 * of the defect this module was introduced to fix (every route served the
 * homepage's title and a canonical pointing at `/`, so all 553 sitemap URLs
 * asked not to be indexed).
 *
 * So these are pure functions over plain data, importing nothing that assumes
 * a browser. `middleware.ts` runs on Vercel's edge runtime — no `document`, no
 * `window` — so nothing here may touch either.
 */
import { SITE_NAME, SITE_URL, pageTitle } from "./constants";

/** Everything a head tag needs, for any route. */
export interface RouteMeta {
  title: string;
  description: string;
  /** Root-relative, always leading-slash. Absolute form is {@link canonicalUrl}. */
  canonicalPath: string;
}

/** The absolute canonical for a route, on the one host the site claims. */
export function canonicalUrl(canonicalPath: string): string {
  return `${SITE_URL}${canonicalPath}`;
}

/** The fields a listing's head tags are derived from — a subset of the public view. */
export interface ListingMetaInput {
  business_name: string;
  city: string;
  city_slug: string;
  slug: string;
  is_claimed: boolean;
  /** Already parsed; pass [] when there are none. */
  services: string[];
}

/**
 * A contractor's listing page.
 *
 * At most four services: the description is a search-result snippet, and a
 * contractor with a dozen licence classes would otherwise push the call to
 * action past where anyone reads.
 */
export function listingMeta(business: ListingMetaInput): RouteMeta {
  const cta = business.is_claimed ? "Call or request a free quote." : "Call for a free quote.";
  const services = business.services.slice(0, 4);
  return {
    title: pageTitle(`${business.business_name} — ${business.city} Home Services`),
    description: services.length
      ? `${business.business_name} in ${business.city}. ${services.join(", ")}. ${cta}`
      : `${business.business_name} in ${business.city}. ${cta}`,
    canonicalPath: `/directory/${business.city_slug}/${business.slug}`,
  };
}

/**
 * De-slugifies a city for display: `sherman-oaks` → `Sherman Oaks`.
 *
 * Used only when no row has loaded yet (or, on the crawler path, when a city
 * has no published listings). A real row's `city` is always preferred, since
 * it carries the city's actual capitalisation.
 */
export function cityLabelFromSlug(citySlug: string): string {
  return citySlug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A city index page. `cityLabel` should be a row's `city` where one is known. */
export function cityMeta(citySlug: string, cityLabel?: string): RouteMeta {
  const label = cityLabel || cityLabelFromSlug(citySlug);
  return {
    title: pageTitle(`${label} Home Service Pros`),
    description: `Browse local home service businesses in ${label}. Call directly — no middleman.`,
    canonicalPath: `/directory/${citySlug}`,
  };
}

/** The directory index. */
export function directoryMeta(): RouteMeta {
  return {
    title: pageTitle("Home Service Directory"),
    description: "Browse local home service businesses by city. Call directly — no middleman.",
    canonicalPath: "/directory",
  };
}

/**
 * The homepage, and the fallback for any route the crawler path does not model.
 *
 * Deliberately NOT used to give an unmodelled route a canonical — see
 * `middleware.ts`. A route that gets the homepage's canonical is precisely the
 * bug being fixed.
 */
export function homeMeta(): RouteMeta {
  return {
    title: `${SITE_NAME} — San Fernando Valley Home Service Directory`,
    description:
      "Browse independent home service businesses across the San Fernando Valley — tree service, " +
      "plumbing, HVAC, electrical and landscaping. Call them directly, no middleman.",
    canonicalPath: "/",
  };
}
