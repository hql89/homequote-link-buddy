import { describe, it, expect } from "vitest";
import {
  extractUrlFromModelText,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  findPageLocation,
  isPlausibleUsPhone,
  phoneMatchesPage,
  isDisallowedByRobots,
  resolveConfidence, summariseEnrichmentRun,
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

  it("filters an unedited website-builder placeholder address", () => {
    // Found in production: a real site, phone-verified, still had this in an
    // unedited template footer. A phone match proves the page belongs to the
    // right business — it says nothing about whether the email was ever set up.
    const html = '<footer>Contact us at <a href="mailto:contact@mysite.com">contact@mysite.com</a></footer>';
    expect(extractEmailsFromHtml(html)).toEqual([]);
  });

  it("filters example.com even when it's the only address on the page", () => {
    const html = "<p>Email: mail@example.com</p>";
    expect(extractEmailsFromHtml(html)).toEqual([]);
  });

  it("keeps a real address alongside a filtered placeholder on the same page", () => {
    const html = '<p>owner@luxairhvac.com</p><p>webmaster@wixpress.com</p>';
    expect(extractEmailsFromHtml(html)).toEqual(["owner@luxairhvac.com"]);
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

/**
 * On 2026-09-26 a manual enrichment run had all 20 rows rejected by an
 * expired Perplexity key (HTTP 401). It was recorded `status: "success"`,
 * rendered on the admin page as "0 verified", and tripped no alarm — because
 * the function only called a run failed if the whole thing threw. It read as
 * a quiet day. That is what these pin.
 */
describe("summariseEnrichmentRun", () => {
  it("records a run where every row failed as a failure", () => {
    const outcome = summariseEnrichmentRun(
      { considered: 20, failed: 20 },
      Array(20).fill("Perplexity API returned 401"),
    );

    expect(outcome.status).toBe("failure");
    // One reason, said once — not twenty copies.
    expect(outcome.errorMessage).toBe(
      "20 of 20 lookups failed. Reason: Perplexity API returned 401",
    );
  });

  it("records a clean run as a success with nothing to report", () => {
    expect(summariseEnrichmentRun({ considered: 20, failed: 0 }, [])).toEqual({
      status: "success",
      errorMessage: null,
    });
  });

  it("treats a run with nothing to do as a success, not a failure", () => {
    // An empty queue is the normal end state, not a fault.
    expect(summariseEnrichmentRun({ considered: 0, failed: 0 }, []).status).toBe("success");
  });

  it("calls a partly-failed run partial, not broken", () => {
    const outcome = summariseEnrichmentRun({ considered: 20, failed: 3 }, ["timeout"]);
    expect(outcome.status).toBe("partial");
    expect(outcome.errorMessage).toContain("3 of 20");
  });

  it("does not treat businesses with no website as failures", () => {
    // no_url / no_email / fetch_failed are findings about a business, not
    // faults on our side. Plenty of small contractors simply have no site,
    // and a run full of those is working correctly.
    expect(summariseEnrichmentRun({ considered: 20, failed: 0 }, []).status).toBe("success");
  });

  it("lists several distinct reasons, capped", () => {
    const outcome = summariseEnrichmentRun(
      { considered: 5, failed: 5 },
      ["401", "401", "timeout", "bad json", "rate limited"],
    );
    expect(outcome.errorMessage).toContain("Reasons:");
    expect(outcome.errorMessage).toContain("401 | timeout | bad json");
    expect(outcome.errorMessage).not.toContain("rate limited");
  });

  it("still reports a failure when nothing recorded a reason", () => {
    const outcome = summariseEnrichmentRun({ considered: 4, failed: 4 }, []);
    expect(outcome.status).toBe("failure");
    expect(outcome.errorMessage).toContain("(not recorded)");
  });
});

// ── Phone plausibility ──────────────────────────────────────────────────────
// Real values pulled off contractor sites on 2026-09-26. Each was shown to a
// reviewer beside the genuine licence number, making an honest business look
// like the wrong one.

describe("isPlausibleUsPhone", () => {
  it.each([
    ["+15294117647", "529 is not an area code in service, and 411 can never be an exchange"],
    ["+19429384556", "942 is not an area code in service"],
    ["+15322729582", "532 is not an area code in service"],
    ["+11234567890", "area code may not start with 1"],
    ["+14999384556", "499 is not an assigned area code"],
    ["+12110001234", "N11 area code"],
    ["+13239110000", "N11 exchange"],
    ["+11111111111", "a single repeated digit"],
  ])("rejects %s — %s", (number) => {
    expect(isPlausibleUsPhone(number)).toBe(false);
  });

  it.each([
    "+18186267440", // Alpha Builders, from CSLB
    "+18006681123", // the toll-free number genuinely on their site
    "+13233258101",
    "+13239633603",
  ])("accepts the real number %s", (number) => {
    expect(isPlausibleUsPhone(number)).toBe(true);
  });
});

describe("extractPhonesFromHtml", () => {
  it("keeps a real number and drops an implausible one on the same page", () => {
    const html = "<p>Call (818) 626-7440</p><p>ref (529) 411-7647</p>";
    expect(extractPhonesFromHtml(html)).toEqual(["+18186267440"]);
  });

  it("does not carve a phone out of a longer run of digits", () => {
    // An order id or timestamp used to donate its first ten digits.
    expect(extractPhonesFromHtml("<p>Order 83231234567890123</p>")).toEqual([]);
  });

  it("still reads the usual written formats", () => {
    expect(extractPhonesFromHtml("<p>+1 (323) 325-8101</p>")).toEqual(["+13233258101"]);
    expect(extractPhonesFromHtml("<p>323.325.8101</p>")).toEqual(["+13233258101"]);
  });
});

// ── Location ────────────────────────────────────────────────────────────────

describe("findPageLocation", () => {
  const AREA = ["Sherman Oaks", "Encino", "Studio City", "Tarzana", "Valley Village", "Toluca Lake"];

  it("reads a full postal address in the service area", () => {
    const loc = findPageLocation("<p>15250 Ventura Blvd, Sherman Oaks, CA 91403</p>", AREA);
    expect(loc.addressCity).toBe("sherman oaks");
    expect(loc.addressInArea).toBe(true);
  });

  it("accepts California spelled out, and no zip", () => {
    // The old regex demanded '<City>, CA <zip>' exactly and so found a
    // location on only 8 of 27 businesses.
    const loc = findPageLocation("<p>Encino, California</p>", AREA);
    expect(loc.addressInArea).toBe(true);
  });

  it("separates a city merely named from one in an address", () => {
    // The distinction the whole decision rests on.
    const loc = findPageLocation("<p>Proudly serving Tarzana and the valley</p>", AREA);
    expect(loc.mentioned).toContain("tarzana");
    expect(loc.addressCity).toBeNull();
    expect(loc.addressInArea).toBe(false);
  });

  it("records an out-of-area address as such", () => {
    const loc = findPageLocation("<p>Main office: Fresno, CA 93721</p>", AREA);
    expect(loc.addressInArea).toBe(false);
    expect(loc.addressCity).toBe("fresno");
  });

  it("prefers a local branch address over a corporate one elsewhere", () => {
    const loc = findPageLocation("<p>HQ: Fresno, CA 93721. Branch: Encino, CA 91316</p>", AREA);
    expect(loc.addressInArea).toBe(true);
    expect(loc.addressCity).toBe("encino");
  });

  it("does not treat Los Angeles as outside the area", () => {
    // Every covered city is a neighbourhood of the City of Los Angeles, so
    // "Los Angeles, CA" is entirely consistent with a Tarzana business. The
    // first cut of this rule flagged exactly that as out-of-area — found by
    // re-running four real businesses through it.
    const loc = findPageLocation("<p>Los Angeles, CA 90015</p>", AREA);
    expect(loc.addressInArea).toBe(false);
    expect(loc.addressNearby).toBe(true);
  });

  it("treats the wider Valley as unremarkable rather than suspicious", () => {
    for (const place of ["Van Nuys", "Woodland Hills", "Burbank", "North Hollywood"]) {
      const loc = findPageLocation(`<p>${place}, CA 91000</p>`, AREA);
      expect(loc.addressNearby, place).toBe(true);
      expect(loc.addressInArea, place).toBe(false);
    }
  });

  it("keeps a genuinely distant address a red flag", () => {
    const loc = findPageLocation("<p>Fresno, CA 93721</p>", AREA);
    expect(loc.addressNearby).toBe(false);
    expect(loc.addressInArea).toBe(false);
  });

  it("gives a clean snippet rather than trailing back into the sentence", () => {
    // Was "Andrew Chang Sherman Oaks, CA" on a real page.
    const loc = findPageLocation("<p>Contact Andrew Chang Sherman Oaks, CA 91403</p>", AREA);
    expect(loc.snippet).toBe("sherman oaks, CA");
  });

  it("finds nothing when the page says nothing", () => {
    const loc = findPageLocation("<p>We serve the whole valley!</p>", AREA);
    expect(loc.addressCity).toBeNull();
    expect(loc.mentioned).toEqual([]);
  });
});

describe("resolveConfidence", () => {
  const AREA = ["Sherman Oaks", "Encino", "Studio City", "Tarzana", "Valley Village", "Toluca Lake"];
  const nowhere = { snippet: null, addressCity: null, addressInArea: false, addressNearby: false, mentioned: [] };

  it("verifies when the site's address is the licence's own city", () => {
    const loc = findPageLocation("<p>Encino, CA 91316</p>", AREA);
    const d = resolveConfidence({ phoneMatched: false, location: loc, expectedCity: "Encino" });
    expect(d.confidence).toBe("verified");
  });

  it("verifies an address in a different covered city", () => {
    const loc = findPageLocation("<p>Tarzana, CA 91356</p>", AREA);
    expect(resolveConfidence({ phoneMatched: false, location: loc, expectedCity: "Encino" }).confidence)
      .toBe("verified");
  });

  it("sends an out-of-area address to review even when the phone matches", () => {
    // The operator's steer: a phone mismatch says little; a site placing the
    // business in another county says a great deal. Location outranks.
    const loc = findPageLocation("<p>Fresno, CA 93721</p>", AREA);
    const d = resolveConfidence({ phoneMatched: true, location: loc, expectedCity: "Encino" });
    expect(d.confidence).toBe("needs_review");
    expect(d.reason).toMatch(/outside the service area/i);
  });

  it("is not fooled by an out-of-area business listing our cities as places it travels", () => {
    // The case this rewrite exists for. Nearly every contractor site carries
    // a long service-area footer; treating that as proof of location would
    // verify a Fresno company that happens to mention Sherman Oaks.
    const html = "<p>Fresno, CA 93721</p><p>Serving Sherman Oaks, Encino and Tarzana</p>";
    const loc = findPageLocation(html, AREA);
    expect(loc.mentioned.length).toBeGreaterThan(0);
    expect(resolveConfidence({ phoneMatched: false, location: loc, expectedCity: "Encino" }).confidence)
      .toBe("needs_review");
  });

  it("does not verify on a service-area mention alone", () => {
    const loc = findPageLocation("<p>We serve Encino!</p>", AREA);
    const d = resolveConfidence({ phoneMatched: false, location: loc, expectedCity: "Encino" });
    expect(d.confidence).toBe("needs_review");
    expect(d.reason).toMatch(/only as somewhere it works/i);
  });

  it("does not flag a nearby address, but does not verify on it either", () => {
    const loc = findPageLocation("<p>Los Angeles, CA 90015</p>", AREA);
    const d = resolveConfidence({ phoneMatched: false, location: loc, expectedCity: "Tarzana" });
    expect(d.confidence).toBe("needs_review");
    expect(d.reason).not.toMatch(/outside the service area/i);
  });

  it("verifies a nearby address when the phone also matches", () => {
    const loc = findPageLocation("<p>Van Nuys, CA 91401</p>", AREA);
    expect(resolveConfidence({ phoneMatched: true, location: loc, expectedCity: "Encino" }).confidence)
      .toBe("verified");
  });

  it("still verifies on a phone match when no address can be read", () => {
    const d = resolveConfidence({ phoneMatched: true, location: nowhere, expectedCity: "Encino" });
    expect(d.confidence).toBe("verified");
    expect(d.reason).toMatch(/phone number matches/i);
  });

  it("sends a row with neither signal to review", () => {
    expect(resolveConfidence({ phoneMatched: false, location: nowhere, expectedCity: "Encino" }).confidence)
      .toBe("needs_review");
  });

  it("always gives the reviewer a reason", () => {
    for (const phoneMatched of [true, false]) {
      const d = resolveConfidence({ phoneMatched, location: nowhere, expectedCity: "Encino" });
      expect(d.reason.length).toBeGreaterThan(20);
    }
  });
});
