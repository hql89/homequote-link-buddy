import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canonicalUrl,
  cityLabelFromSlug,
  cityMeta,
  directoryMeta,
  homeMeta,
  listingMeta,
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
