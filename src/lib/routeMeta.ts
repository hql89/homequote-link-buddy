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

/**
 * What each trade is called in a sentence.
 *
 * The `verticals` table's own labels are category headings ("Electrical",
 * "Yard & Landscaping") and do not read as a noun for a person — "Oren Diamant
 * is an Electrical in Tarzana" is not a sentence. These are the same five
 * slugs said the way a homeowner would say them.
 *
 * Deliberately a lookup with a fallback and never a direct index: the trades
 * are rows in a table, so a sixth can be added without touching this file, and
 * a slug that is missing here must degrade to the old wording rather than
 * render "undefined" on 536 public pages. See {@link tradeNoun}.
 */
const TRADE_NOUNS: Record<string, string> = {
  electrical: "electrician",
  plumbing: "plumber",
  hvac: "heating and air conditioning contractor",
  landscaping: "landscaper",
  "tree-service": "tree service",
};

/** Title-case form, for a heading or a badge. */
const TRADE_TITLES: Record<string, string> = {
  electrical: "Electrician",
  plumbing: "Plumber",
  hvac: "HVAC Contractor",
  landscaping: "Landscaper",
  "tree-service": "Tree Service",
};

/**
 * The sentence noun for a trade slug, or null when this build does not know it.
 * Null is a real answer and every caller must handle it — an unknown trade
 * falls back to the wording used before trades were shown at all.
 */
export function tradeNoun(verticalSlug: string | null | undefined): string | null {
  if (!verticalSlug) return null;
  return TRADE_NOUNS[verticalSlug] ?? null;
}

/** Title-case counterpart of {@link tradeNoun}, same null contract. */
export function tradeTitle(verticalSlug: string | null | undefined): string | null {
  if (!verticalSlug) return null;
  return TRADE_TITLES[verticalSlug] ?? null;
}

/**
 * The trade with its article — "an electrician", "a plumber" — or null when
 * the trade is unknown.
 *
 * Exported because the listing page needs the identical phrase in its body
 * text. Building it separately there produced "a electrician" on all 263
 * electrician listings at once, which is the whole reason this is one function
 * and not a template literal repeated at each call site.
 */
export function tradeWithArticle(verticalSlug: string | null | undefined): string | null {
  const noun = tradeNoun(verticalSlug);
  if (!noun) return null;
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
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
  /** The trade this listing is filed under. Null is normal and handled. */
  vertical_slug?: string | null;
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
  const title = tradeTitle(business.vertical_slug);

  // The trade is what makes one of 536 listings distinguishable from the rest.
  // Every page previously read "<name> — <city> Home Services" with a body of
  // "<name> in <city>. Call for a free quote.", which is the same sentence 536
  // times with two words swapped — crawled, and then not indexed. Naming the
  // trade is the one fact already in the database that separates them, and it
  // is also what a homeowner is actually searching for.
  const phrase = tradeWithArticle(business.vertical_slug);
  const subject = phrase
    ? `${business.business_name} is ${phrase} serving ${business.city}`
    : `${business.business_name} in ${business.city}`;

  return {
    title: pageTitle(
      title
        ? `${business.business_name} — ${title} in ${business.city}`
        : `${business.business_name} — ${business.city} Home Services`,
    ),
    description: services.length
      ? `${subject}. ${services.join(", ")}. ${cta}`
      : `${subject}. ${cta}`,
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
