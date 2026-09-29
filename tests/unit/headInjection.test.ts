import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { injectHead } from "../../src/lib/headInjection";
import { canonicalUrl, cityMeta, listingMeta } from "../../src/lib/routeMeta";

/** The real shell, so these tests break if its head is restructured. */
const SHELL = readFileSync("index.html", "utf8");

const BUSINESS = {
  business_name: "Capitol Plumbing & Rooter Inc",
  city: "Encino",
  city_slug: "encino",
  slug: "capitol-plumbing-rooter-inc",
  is_claimed: false,
  services: ["Drain cleaning"],
};

describe("injectHead", () => {
  it("replaces the homepage title with the route's own", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    expect(out).toMatch(/<title>[^<]*Capitol Plumbing &amp; Rooter Inc[^<]*<\/title>/);
    // The shell's own title must be gone, not merely joined by a second one.
    expect(out).not.toContain("<title>Valley Home Pros — San Fernando Valley");
    expect(out.match(/<title>/g)).toHaveLength(1);
  });

  it("adds a canonical naming this route, since the shell has none", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    const expected = canonicalUrl("/directory/encino/capitol-plumbing-rooter-inc");
    expect(out).toContain(`<link rel="canonical" href="${expected}" />`);
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
  });

  it("never emits a canonical pointing at the homepage for a non-home route", () => {
    // The defect, stated as a test. Both routes below used to get href="/".
    for (const meta of [listingMeta(BUSINESS), cityMeta("encino")]) {
      const out = injectHead(SHELL, meta);
      expect(out).not.toMatch(/rel="canonical" href="https:\/\/www\.homequotelink\.com\/"/);
    }
  });

  it("replaces the description rather than adding a second one", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    expect(out.match(/<meta name="description"/g)).toHaveLength(1);
    expect(out).toContain("Capitol Plumbing &amp; Rooter Inc in Encino.");
  });

  it("sets the Open Graph tags a link preview reads", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    expect(out).toMatch(/<meta property="og:title" content="[^"]*Capitol Plumbing/);
    expect(out).toMatch(/<meta property="og:url" content="[^"]*capitol-plumbing-rooter-inc"/);
    expect(out.match(/property="og:url"/g)).toHaveLength(1);
  });

  it("escapes the ampersand in a business name so the HTML stays valid", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    expect(out).not.toMatch(/<title>[^<]*Rooter Inc[^<]*&(?!amp;|lt;|gt;|quot;)/);
  });

  it("escapes a quote in a description rather than breaking out of the attribute", () => {
    const out = injectHead(SHELL, {
      title: "T",
      description: 'He said "hello" — and <script>alert(1)</script>',
      canonicalPath: "/x",
    });
    expect(out).toContain("&quot;hello&quot;");
    expect(out).not.toContain('content="He said "hello""');
    expect(out).not.toContain("<script>alert(1)</script>");
  });

  // The failure posture from the plan: a lookup failure must cost a meta tag,
  // never the page. This is the test that pins it.
  it("returns the page byte-identical when there is no meta", () => {
    expect(injectHead(SHELL, null)).toBe(SHELL);
  });

  it("leaves everything outside the head untouched", () => {
    const out = injectHead(SHELL, listingMeta(BUSINESS));
    const body = (s: string) => s.slice(s.indexOf("</head>"));
    expect(body(out)).toBe(body(SHELL));
  });
});
