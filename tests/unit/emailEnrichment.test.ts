import { describe, it, expect } from "vitest";
import {
  extractUrlFromModelText,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  phoneMatchesPage,
  isDisallowedByRobots,
  resolveConfidence,
} from "../../supabase/functions/_shared/emailEnrichment";

describe("extractUrlFromModelText", () => {
  it("pulls a URL out of prose", () => {
    expect(extractUrlFromModelText("Their official site is https://luxairhvac.com — hope that helps!"))
      .toBe("https://luxairhvac.com");
  });

  it("trims trailing sentence punctuation", () => {
    expect(extractUrlFromModelText("Try https://example.com/contact.")).toBe("https://example.com/contact");
  });

  it("returns null when the model gives prose with no URL", () => {
    expect(extractUrlFromModelText("I don't have enough information to find their website.")).toBeNull();
  });

  it("returns null for an empty response", () => {
    expect(extractUrlFromModelText("")).toBeNull();
  });
});

describe("extractEmailsFromHtml", () => {
  it("prefers mailto: links", () => {
    const html = '<a href="mailto:owner@luxairhvac.com">Email us</a>';
    expect(extractEmailsFromHtml(html)).toEqual(["owner@luxairhvac.com"]);
  });

  it("finds a plain-text email in page content", () => {
    const html = "<p>Contact us at info@perfectelectric.com for a quote.</p>";
    expect(extractEmailsFromHtml(html)).toEqual(["info@perfectelectric.com"]);
  });

  it("de-duplicates and lower-cases", () => {
    const html = '<a href="mailto:Owner@Site.com">x</a><p>owner@site.com</p>';
    expect(extractEmailsFromHtml(html)).toEqual(["owner@site.com"]);
  });

  it("filters out asset filenames that happen to match the email shape", () => {
    const html = '<img src="team@2x.png"><script src="bundle@1.js"></script>';
    expect(extractEmailsFromHtml(html)).toEqual([]);
  });

  it("returns an empty array when nothing is found", () => {
    expect(extractEmailsFromHtml("<p>No contact info here.</p>")).toEqual([]);
  });
});

describe("extractPhonesFromHtml", () => {
  it("finds and normalises a formatted phone number", () => {
    expect(extractPhonesFromHtml("<p>Call us: (818) 555-0142</p>")).toEqual(["+18185550142"]);
  });

  it("finds a phone already in E.164-ish form", () => {
    expect(extractPhonesFromHtml("Contact: +1 818 555 0142")).toEqual(["+18185550142"]);
  });

  it("returns empty when no phone-shaped text exists", () => {
    expect(extractPhonesFromHtml("<p>No phone listed.</p>")).toEqual([]);
  });
});

describe("phoneMatchesPage", () => {
  it("matches when the CSLB phone normalises to one found on the page", () => {
    expect(phoneMatchesPage("(818) 555-0142", ["+18185550142"])).toBe(true);
  });

  it("does not match a different number", () => {
    expect(phoneMatchesPage("(818) 555-0142", ["+13105559999"])).toBe(false);
  });

  it("does not match when the CSLB phone itself is unparseable", () => {
    expect(phoneMatchesPage("not a phone", ["+18185550142"])).toBe(false);
  });

  it("does not match against an empty page-phone list", () => {
    expect(phoneMatchesPage("(818) 555-0142", [])).toBe(false);
  });
});

describe("resolveConfidence", () => {
  it("is 'verified' only when the phone matched", () => {
    expect(resolveConfidence(true)).toBe("verified");
  });

  it("is 'needs_review' when it did not", () => {
    expect(resolveConfidence(false)).toBe("needs_review");
  });
});

describe("isDisallowedByRobots", () => {
  it("respects a blanket disallow for all agents", () => {
    const robots = "User-agent: *\nDisallow: /";
    expect(isDisallowedByRobots(robots, "/contact", "ValleyHomeProsBot")).toBe(true);
  });

  it("allows when robots.txt has no matching disallow", () => {
    const robots = "User-agent: *\nDisallow: /admin";
    expect(isDisallowedByRobots(robots, "/contact", "ValleyHomeProsBot")).toBe(false);
  });

  it("allows a path outside a specific disallowed prefix", () => {
    const robots = "User-agent: *\nDisallow: /private/";
    expect(isDisallowedByRobots(robots, "/contact", "ValleyHomeProsBot")).toBe(false);
  });

  it("treats empty robots.txt as fully allowed", () => {
    expect(isDisallowedByRobots("", "/contact", "ValleyHomeProsBot")).toBe(false);
  });
});
