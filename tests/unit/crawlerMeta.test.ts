import { describe, it, expect, vi } from "vitest";
import { metaForPath, type RowFetcher } from "../../src/lib/crawlerMeta";

/**
 * These cover the integration half of the crawler fix — route matching and the
 * row-to-meta mapping — with the network injected. Without them the only proof
 * would be deploying and eyeballing, which is how a silent regression returns.
 */

const LISTING_ROW = {
  business_name: "Capitol Plumbing & Rooter Inc",
  city: "Encino",
  city_slug: "encino",
  slug: "capitol-plumbing-rooter-inc",
  is_claimed: false,
  services: ["Drain cleaning", "Water heaters"],
};

/** A fetcher that returns the given rows for any query. */
const rows = (r: unknown[] | null): RowFetcher => vi.fn(async () => r);

/** A fetcher that must never be called. */
const never: RowFetcher = vi.fn(async () => {
  throw new Error("should not query for this route");
});

describe("metaForPath — routes that need no lookup", () => {
  it("maps the homepage without querying", async () => {
    const m = await metaForPath("/", never);
    expect(m?.canonicalPath).toBe("/");
    expect(never).not.toHaveBeenCalled();
  });

  it("maps the directory index without querying", async () => {
    const m = await metaForPath("/directory", never);
    expect(m?.canonicalPath).toBe("/directory");
  });

  it("ignores a trailing slash rather than treating it as another route", async () => {
    // /directory and /directory/ must not disagree about their canonical, or the
    // two forms would compete as duplicates — the problem being fixed.
    expect((await metaForPath("/directory/", never))?.canonicalPath).toBe("/directory");
    expect((await metaForPath("//", never))?.canonicalPath).toBe("/");
  });
});

describe("metaForPath — city pages", () => {
  it("uses a real row's capitalisation of the city", async () => {
    const m = await metaForPath("/directory/sherman-oaks", rows([{ city: "Sherman Oaks" }]));
    expect(m?.title).toContain("Sherman Oaks");
    expect(m?.canonicalPath).toBe("/directory/sherman-oaks");
  });

  it("still produces meta for a city with no published listings", async () => {
    // A city page with nothing in it is a real page and should say which city it
    // is; falling through would leave it with the homepage's title.
    const m = await metaForPath("/directory/valley-village", rows([]));
    expect(m?.title).toContain("Valley Village");
    expect(m?.canonicalPath).toBe("/directory/valley-village");
  });

  it("still produces meta when the lookup fails outright", async () => {
    const m = await metaForPath("/directory/encino", rows(null));
    expect(m?.title).toContain("Encino");
  });
});

describe("metaForPath — listing pages", () => {
  it("maps a row to that business's own title and canonical", async () => {
    const m = await metaForPath("/directory/encino/capitol-plumbing-rooter-inc", rows([LISTING_ROW]));
    expect(m?.title).toContain("Capitol Plumbing & Rooter Inc");
    expect(m?.canonicalPath).toBe("/directory/encino/capitol-plumbing-rooter-inc");
    expect(m?.description).toContain("Drain cleaning");
  });

  it("parses services that arrive as a JSON string", async () => {
    // The column is JSONB and has been observed arriving stringified.
    const m = await metaForPath(
      "/directory/encino/x",
      rows([{ ...LISTING_ROW, services: '["Repiping"]' }]),
    );
    expect(m?.description).toContain("Repiping");
  });

  it("survives a row whose services are unusable", async () => {
    const m = await metaForPath("/directory/encino/x", rows([{ ...LISTING_ROW, services: "{oops" }]));
    expect(m?.description).toContain("Capitol Plumbing");
    expect(m?.description).not.toContain("oops");
  });

  it("returns nothing for an unpublished or nonexistent listing", async () => {
    // The public view already excludes unpublished and archived rows, so no row
    // means the app will render its own not-found state. Giving that a rich title
    // would be worse than giving it none.
    expect(await metaForPath("/directory/encino/ghost", rows([]))).toBeNull();
  });

  it("returns nothing when the lookup fails, rather than throwing", async () => {
    // The failure posture: a lookup failure must cost a meta tag, not the page.
    expect(await metaForPath("/directory/encino/x", rows(null))).toBeNull();
  });

  it("returns nothing for a row missing the fields a title needs", async () => {
    expect(
      await metaForPath("/directory/encino/x", rows([{ ...LISTING_ROW, business_name: null }])),
    ).toBeNull();
    expect(await metaForPath("/directory/encino/x", rows([{ ...LISTING_ROW, city: null }]))).toBeNull();
  });
});

describe("metaForPath — routes it must not claim", () => {
  it.each(["/faq", "/blog", "/blog/some-post", "/providers", "/admin/leads", "/login"])(
    "returns nothing for %s",
    async (path) => {
      // Returning meta here would be guessing. No canonical is correct (a URL is
      // its own canonical); a guessed one is the defect being fixed.
      expect(await metaForPath(path, never)).toBeNull();
    },
  );

  it("returns nothing for a directory path with too many segments", async () => {
    expect(await metaForPath("/directory/encino/slug/extra", never)).toBeNull();
  });
});
