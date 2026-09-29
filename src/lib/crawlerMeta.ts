/**
 * Resolves a request path to the head tags a crawler should receive.
 *
 * Lives here rather than inside `middleware.ts` so it can be tested without an
 * edge runtime: the network call is injected. That matters because this is the
 * integration-level half of the crawler fix — the route matching and the
 * row-to-meta mapping — and covering it only by deploying and eyeballing is how
 * a silent regression gets in. `middleware.ts` keeps only the parts that
 * genuinely need Vercel: the matcher, fetching the built shell, and the response.
 *
 * Nothing here may touch `document` or `window`; the edge runtime has neither.
 */
import { cityMeta, directoryMeta, homeMeta, listingMeta, type RouteMeta } from "./routeMeta";

/** Fetches JSON rows for a PostgREST query. Injected so tests need no network. */
export type RowFetcher = (query: string) => Promise<unknown[] | null>;

/** Parsed JSON shape of one row of `public_business_listings`. */
interface ListingRow {
  business_name: string | null;
  city: string | null;
  city_slug: string | null;
  slug: string | null;
  is_claimed: boolean | null;
  services: unknown;
}

/** Normalises the `services` JSONB column, which may arrive as a JSON string. */
function parseServices(raw: unknown): string[] {
  const clean = (arr: unknown[]): string[] =>
    arr
      .filter((s) => s !== null && s !== undefined)
      .map((s) => String(s).trim())
      .filter(Boolean);
  if (Array.isArray(raw)) return clean(raw);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? clean(parsed) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Reads one listing from the public view.
 *
 * The view, never `businesses`: it omits the claim token and already filters
 * unpublished and archived rows, so an unpublished listing yields no meta and
 * the page falls through unchanged — which is what should happen.
 */
async function fetchListing(
  fetchRows: RowFetcher,
  citySlug: string,
  slug: string,
): Promise<ListingRow | null> {
  const rows = await fetchRows(
    `public_business_listings` +
      `?select=business_name,city,city_slug,slug,is_claimed,services` +
      `&city_slug=eq.${encodeURIComponent(citySlug)}` +
      `&slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  return (rows?.[0] as ListingRow | undefined) ?? null;
}

/** Reads any one row of a city, only for its real capitalisation of the name. */
async function fetchCityLabel(
  fetchRows: RowFetcher,
  citySlug: string,
): Promise<string | undefined> {
  const rows = await fetchRows(
    `public_business_listings?select=city&city_slug=eq.${encodeURIComponent(citySlug)}&limit=1`,
  );
  return (rows?.[0] as { city: string | null } | undefined)?.city ?? undefined;
}

/** The meta for a path, or null when the route is not modelled or data is missing. */
export async function metaForPath(
  pathname: string,
  fetchRows: RowFetcher,
): Promise<RouteMeta | null> {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return homeMeta();
  if (path === "/directory") return directoryMeta();

  const segments = path.split("/").filter(Boolean); // ["directory", city, slug?]
  if (segments[0] !== "directory") return null;

  if (segments.length === 2) {
    return cityMeta(segments[1], await fetchCityLabel(fetchRows, segments[1]));
  }

  if (segments.length === 3) {
    const row = await fetchListing(fetchRows, segments[1], segments[2]);
    // No row means unpublished, archived or nonexistent. The app renders its own
    // "not found" state; giving that a rich title would be worse than none.
    if (!row?.business_name || !row.city || !row.city_slug || !row.slug) return null;
    return listingMeta({
      business_name: row.business_name,
      city: row.city,
      city_slug: row.city_slug,
      slug: row.slug,
      is_claimed: row.is_claimed ?? false,
      services: parseServices(row.services),
    });
  }

  return null;
}
