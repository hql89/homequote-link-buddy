import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canonicalUrl,
  cityLabelFromSlug,
  cityMeta,
  directoryMeta,
  homeMeta,
  listingMeta,
  tradeNoun,
  tradeTitle,
  tradeWithArticle,
} from "../../src/lib/routeMeta";
import { SITE_URL } from "../../src/lib/constants";

const BUSINESS = {
  business_name: "Capitol Plumbing & Rooter Inc",
  city: "Encino",
  city_slug: "encino",
  slug: "capitol-plumbing-rooter-inc",
  is_claimed: false,
  services: ["Drain cleaning", "Water heaters", "Repiping", "Leak detection", "Sewer video"],
};

describe("listingMeta", () => {
  it("titles the page after the business and its city, not the site", () => {
    // The defect this module exists for: every page carried the homepage's
    // title. A listing's title must name the business.
    expect(listingMeta(BUSINESS).title).toContain("Capitol Plumbing & Rooter Inc");
    expect(listingMeta(BUSINESS).title).toContain("Encino");
  });

  it("canonicalises to the listing's own path", () => {
    expect(listingMeta(BUSINESS).canonicalPath).toBe("/directory/encino/capitol-plumbing-rooter-inc");
  });

  it("caps the description at four services so the call to action survives", () => {
    const d = listingMeta(BUSINESS).description;
    expect(d).toContain("Leak detection");
    expect(d).not.toContain("Sewer video");
    expect(d).toMatch(/Call for a free quote\.$/);
  });

  it("omits the service list rather than leaving a gap when there are none", () => {
    const d = listingMeta({ ...BUSINESS, services: [] }).description;
    expect(d).toBe("Capitol Plumbing & Rooter Inc in Encino. Call for a free quote.");
  });

  /**
   * Why the trade is in the head tags at all: on 2026-11-06 Google had indexed
   * 2 of 553 submitted URLs — the homepage and /directory — and zero listings,
   * five weeks after the crawler head-tag fix shipped and worked. The pages
   * were crawled and declined. All 536 listings have no services, no blurb and
   * no website, so every title read "<name> — <city> Home Services" and every
   * description "<name> in <city>. Call for a free quote." The trade is the one
   * distinguishing fact already in the database.
   */
  describe("the trade", () => {
    const ELECTRICIAN = { ...BUSINESS, services: [], vertical_slug: "electrical" };

    it("names the trade in the title instead of the generic 'Home Services'", () => {
      const t = listingMeta(ELECTRICIAN).title;
      expect(t).toContain("Electrician in Encino");
      expect(t).not.toContain("Home Services");
    });

    it("makes the description a sentence about the trade, not the name twice", () => {
      expect(listingMeta(ELECTRICIAN).description).toBe(
        "Capitol Plumbing & Rooter Inc is an electrician serving Encino. Call for a free quote.",
      );
    });

    it("reads correctly for the general-contractor trade", () => {
      const d = listingMeta({
        ...BUSINESS,
        services: [],
        vertical_slug: "general-contractor",
      }).description;
      expect(d).toContain("is a general contractor serving Encino");
      expect(
        listingMeta({ ...BUSINESS, vertical_slug: "general-contractor" }).title,
      ).toContain("General Contractor in Encino");
    });

    it("gives the page body the same article-correct phrase as the meta", () => {
      // Built separately in the page once, which rendered "a electrician" on
      // all 263 electrician listings. One function, both callers.
      expect(tradeWithArticle("electrical")).toBe("an electrician");
      expect(tradeWithArticle("plumbing")).toBe("a plumber");
      expect(tradeWithArticle("hvac")).toBe("a heating and air conditioning contractor");
      expect(tradeWithArticle("roofing")).toBeNull();
      expect(tradeWithArticle(null)).toBeNull();
    });

    it("picks the right article for a vowel-initial trade", () => {
      // "a electrician" is the kind of thing that ships to 263 pages at once.
      expect(listingMeta(ELECTRICIAN).description).toContain("is an electrician");
      expect(
        listingMeta({ ...BUSINESS, services: [], vertical_slug: "plumbing" }).description,
      ).toContain("is a plumber");
    });

    it("still lists services when there are some, after the trade", () => {
      const d = listingMeta({ ...BUSINESS, vertical_slug: "plumbing" }).description;
      expect(d).toContain("is a plumber serving Encino");
      expect(d).toContain("Drain cleaning");
    });

    it("puts the CSLB licence in the description, as a number and not a status", () => {
      // The most checkable fact these listings have, and unique per listing
      // where almost nothing else is. Stated as a bare number on purpose:
      // license_status reads ACTIVE on all 536 rows but license_expires_at is
      // NULL on all of them, so "licensed" or "active" would outrun the data.
      const d = listingMeta({ ...ELECTRICIAN, license_number: "1031050" }).description;
      expect(d).toBe(
        "Capitol Plumbing & Rooter Inc is an electrician serving Encino. CSLB licence #1031050. Call for a free quote.",
      );
      expect(d).not.toMatch(/active/i);
      expect(d).not.toMatch(/verified/i);
    });

    it("leaves the description clean when there is no licence", () => {
      for (const v of [null, undefined]) {
        const d = listingMeta({ ...ELECTRICIAN, license_number: v }).description;
        expect(d).toBe("Capitol Plumbing & Rooter Inc is an electrician serving Encino. Call for a free quote.");
        expect(d).not.toContain("undefined");
        expect(d).not.toContain("  ");
      }
    });

    /**
     * The trades are rows in the `verticals` table, so a sixth can be added
     * without touching this file. An unknown slug must read as it did before
     * trades were shown — never "undefined", which is exactly how the retired
     * hardcoded VERTICALS map used to fail.
     */
    it("falls back to the old wording for a trade this build does not know", () => {
      const unknown = { ...BUSINESS, services: [], vertical_slug: "roofing" };
      expect(listingMeta(unknown).description).toBe(
        "Capitol Plumbing & Rooter Inc in Encino. Call for a free quote.",
      );
      expect(listingMeta(unknown).title).toContain("Encino Home Services");
      expect(listingMeta(unknown).description).not.toContain("undefined");
      expect(listingMeta(unknown).title).not.toContain("undefined");
    });

    it("treats a missing trade the same as an unknown one", () => {
      for (const v of [null, undefined]) {
        const d = listingMeta({ ...BUSINESS, services: [], vertical_slug: v }).description;
        expect(d).toBe("Capitol Plumbing & Rooter Inc in Encino. Call for a free quote.");
      }
    });

    it("covers every trade currently in the verticals table", () => {
      // These five are what `select slug from verticals where is_active` returned
      // on 2026-11-06. A new row added without a word here degrades safely, but
      // the listing loses the distinguishing fact — so this is a prompt, not a gate.
      for (const slug of [
        "electrical",
        "plumbing",
        "hvac",
        "landscaping",
        "tree-service",
        "general-contractor",
      ]) {
        expect(tradeNoun(slug)).toBeTruthy();
        expect(tradeTitle(slug)).toBeTruthy();
      }
      expect(tradeNoun("roofing")).toBeNull();
      expect(tradeTitle("roofing")).toBeNull();
    });
  });

  it("invites a quote request only once the listing is claimed", () => {
    // An unclaimed listing has no owner watching the form, so the copy must not
    // promise one will answer it.
    expect(listingMeta({ ...BUSINESS, is_claimed: true }).description).toContain(
      "Call or request a free quote.",
    );
    expect(listingMeta(BUSINESS).description).toContain("Call for a free quote.");
  });
});

describe("cityMeta", () => {
  it("prefers a real row's capitalisation over the slug", () => {
    expect(cityMeta("sherman-oaks", "Sherman Oaks").title).toContain("Sherman Oaks");
  });

  it("de-slugifies when no row has loaded, rather than showing the slug", () => {
    expect(cityMeta("sherman-oaks").title).toContain("Sherman Oaks");
    expect(cityMeta("sherman-oaks").title).not.toContain("sherman-oaks");
  });

  it("canonicalises to the city's own path", () => {
    expect(cityMeta("encino").canonicalPath).toBe("/directory/encino");
  });
});

describe("cityLabelFromSlug", () => {
  it.each([
    ["encino", "Encino"],
    ["sherman-oaks", "Sherman Oaks"],
    ["valley-village", "Valley Village"],
  ])("%s -> %s", (slug, label) => {
    expect(cityLabelFromSlug(slug)).toBe(label);
  });
});

describe("canonicalUrl", () => {
  it("builds on the one host the site claims, and that host is www", () => {
    // The apex 308-redirects to www, so a canonical on the apex names a URL that
    // immediately redirects — a quieter version of the bug being fixed.
    expect(canonicalUrl("/directory")).toBe("https://www.homequotelink.com/directory");
    expect(SITE_URL).toBe("https://www.homequotelink.com");
  });
});

describe("no route claims to be another", () => {
  it("gives every modelled route a canonical of its own", () => {
    const paths = [
      homeMeta().canonicalPath,
      directoryMeta().canonicalPath,
      cityMeta("encino").canonicalPath,
      listingMeta(BUSINESS).canonicalPath,
    ];
    expect(new Set(paths).size).toBe(paths.length);
    // Only the homepage may canonicalise to "/". This is the assertion that
    // would have caught the original defect.
    expect(paths.filter((p) => p === "/")).toEqual(["/"]);
  });

  it("gives every modelled route a distinct title", () => {
    const titles = [
      homeMeta().title,
      directoryMeta().title,
      cityMeta("encino").title,
      listingMeta(BUSINESS).title,
    ];
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("the shell no longer carries a static canonical", () => {
  // index.html is served for EVERY route, so any canonical in it applies to all
  // 553 URLs. This is the regression guard for the original defect; it is the
  // reason a comment in index.html says not to reinstate the line.
  it("has no canonical in index.html", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/<link[^>]+rel=["']canonical["']/i);
  });
});
