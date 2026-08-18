import { describe, it, expect } from "vitest";
import {
  slugify,
  renderTemplate,
  toE164,
  DEFAULT_OUTREACH_TEMPLATES,
  isActiveLicense,
  isExpired,
  findRawField,
  formatPhoneDisplay as formatPhoneDisplayShared,
} from "../../supabase/functions/_shared/directory";
import {
  parseServices,
  isFeatured,
  formatPhoneDisplay,
  toTelHref,
} from "../../src/integrations/supabase/directory";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Sherman Oaks Tree Pros")).toBe("sherman-oaks-tree-pros");
  });

  it("strips accents", () => {
    expect(slugify("Jardinería Móntez")).toBe("jardineria-montez");
  });

  it("expands ampersands so words don't fuse", () => {
    expect(slugify("Tree & Stump")).toBe("tree-and-stump");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --Valley Trees!!  ")).toBe("valley-trees");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("")).toBe("");
  });

  it("caps length to keep URLs sane", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("renderTemplate", () => {
  it("substitutes variables", () => {
    expect(renderTemplate("Hi {{name}} from {{city}}", { name: "Dana", city: "Reseda" }))
      .toBe("Hi Dana from Reseda");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ name }}", { name: "Dana" })).toBe("Hi Dana");
  });

  it("collapses unknown tokens to empty rather than leaking {{var}} into an email", () => {
    expect(renderTemplate("Hi {{missing}}!", {})).toBe("Hi !");
  });

  it("replaces every occurrence", () => {
    expect(renderTemplate("{{a}}-{{a}}", { a: "x" })).toBe("x-x");
  });
});

describe("toE164", () => {
  it("normalises a 10-digit US number", () => {
    expect(toE164("(818) 555-0123")).toBe("+18185550123");
  });

  it("normalises an 11-digit number with country code", () => {
    expect(toE164("1-818-555-0123")).toBe("+18185550123");
  });

  it("passes through an already-valid E.164 number", () => {
    expect(toE164("+448185550123")).toBe("+448185550123");
  });

  it("returns null for junk so callers never dial garbage", () => {
    expect(toE164("555-01")).toBeNull();
    expect(toE164("not a phone")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });
});

describe("parseServices", () => {
  it("passes through an array", () => {
    expect(parseServices(["Trimming", "Removal"])).toEqual(["Trimming", "Removal"]);
  });

  it("parses a JSON string from JSONB", () => {
    expect(parseServices('["Trimming","Removal"]')).toEqual(["Trimming", "Removal"]);
  });

  it("returns an empty array for malformed or missing input", () => {
    expect(parseServices("not json")).toEqual([]);
    expect(parseServices(null)).toEqual([]);
    expect(parseServices(undefined)).toEqual([]);
    expect(parseServices(42)).toEqual([]);
  });

  it("drops empty entries", () => {
    expect(parseServices(["Trimming", "", null])).toEqual(["Trimming"]);
  });
});

describe("formatPhoneDisplay", () => {
  it("renders a stored E.164 number readably", () => {
    // Listings store E.164; showing "+18185550102" raw is what this fixes.
    expect(formatPhoneDisplay("+18185550102")).toBe("(818) 555-0102");
  });

  it("handles a bare 10-digit number", () => {
    expect(formatPhoneDisplay("8185550102")).toBe("(818) 555-0102");
  });

  it("passes through anything it can't confidently format", () => {
    expect(formatPhoneDisplay("ext. 4")).toBe("ext. 4");
    expect(formatPhoneDisplay("+448185550123")).toBe("+448185550123");
  });
});

/**
 * `_shared/directory.ts` (Deno, used by send-outreach-drip) carries its own
 * copy of formatPhoneDisplay because edge functions cannot import from src/.
 * A real business (Urban Soil Landscape Inc, 2026-08-18) received
 * "+18182164731" in an outreach email before this twin existed — found by
 * reading the BCC test copy of the first live send, not by any test, because
 * nothing had previously asserted the two copies stay identical. This does.
 */
describe("formatPhoneDisplay — frontend/edge-function parity", () => {
  it.each([
    ["+18185550102", "(818) 555-0102"],
    ["8185550102", "(818) 555-0102"],
    ["ext. 4", "ext. 4"],
    ["+448185550123", "+448185550123"],
  ])("both copies render %s the same way", (input, expected) => {
    expect(formatPhoneDisplayShared(input)).toBe(expected);
    expect(formatPhoneDisplayShared(input)).toBe(formatPhoneDisplay(input));
  });
});

describe("toTelHref", () => {
  it("builds a dialable href from either stored form", () => {
    expect(toTelHref("+18185550102")).toBe("tel:+18185550102");
    expect(toTelHref("(818) 555-0102")).toBe("tel:+18185550102");
  });
});

describe("isFeatured", () => {
  it("is true only for the featured tier", () => {
    expect(isFeatured({ listing_tier: "featured" })).toBe(true);
    expect(isFeatured({ listing_tier: "free" })).toBe(false);
  });

  it("defaults to not-featured for missing data rather than granting perks", () => {
    expect(isFeatured(null)).toBe(false);
    expect(isFeatured(undefined)).toBe(false);
  });

  it("does not treat an unknown tier as featured", () => {
    // A tier added in the DB but not yet handled here must fail closed.
    expect(isFeatured({ listing_tier: "premium" as never })).toBe(false);
  });
});

describe("isActiveLicense", () => {
  it("accepts CLEAR and ACTIVE", () => {
    expect(isActiveLicense("CLEAR")).toBe(true);
    expect(isActiveLicense("Active")).toBe(true);
  });

  it("rejects a suspended licence", () => {
    expect(isActiveLicense("Work Comp Susp")).toBe(false);
    expect(isActiveLicense("SOS Suspension")).toBe(false);
  });

  it("fails closed for missing status", () => {
    expect(isActiveLicense(null)).toBe(false);
    expect(isActiveLicense(undefined)).toBe(false);
    expect(isActiveLicense("")).toBe(false);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-07-30");

  it("flags a past expiration date", () => {
    expect(isExpired("01/01/2020", now)).toBe(true);
  });

  it("does not flag a future expiration date", () => {
    expect(isExpired("01/01/2030", now)).toBe(false);
  });

  it("treats an unparseable date as not expired", () => {
    expect(isExpired("not a date", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
});

describe("findRawField", () => {
  it("matches the header regardless of punctuation or casing", () => {
    const raw = { "Primary Status": "CLEAR", "Expiration Date": "01/01/2030" };
    expect(findRawField(raw, "status")).toBe("CLEAR");
    expect(findRawField(raw, "expires")).toBe("01/01/2030");
  });

  it("matches header aliases used by other CSLB export formats", () => {
    expect(findRawField({ LicenseStatus: "ACTIVE" }, "status")).toBe("ACTIVE");
    expect(findRawField({ ExpDate: "05/01/2027" }, "expires")).toBe("05/01/2027");
  });

  it("returns undefined when the column is absent, rather than guessing", () => {
    expect(findRawField({ BusinessName: "Acme" }, "status")).toBeUndefined();
    expect(findRawField(null, "status")).toBeUndefined();
    expect(findRawField(undefined, "expires")).toBeUndefined();
  });
});

describe("outreach templates", () => {
  it("keeps Email 1 free of links for cold-send deliverability", () => {
    const { body, subject } = DEFAULT_OUTREACH_TEMPLATES.outreach_verify;
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/\{\{\s*claim_url\s*\}\}/);
    expect(subject).toContain("{{business_name}}");
  });

  it("puts the claim link in Email 2", () => {
    expect(DEFAULT_OUTREACH_TEMPLATES.outreach_preview.body).toContain("{{claim_url}}");
  });

  it("renders Email 2 into a real claim URL", () => {
    const rendered = renderTemplate(DEFAULT_OUTREACH_TEMPLATES.outreach_preview.body, {
      owner_name: "Dana",
      claim_url: "https://example.com/directory/reseda/tree-pros/claim?token=abc",
      sender_name: "David",
    });
    expect(rendered).toContain("https://example.com/directory/reseda/tree-pros/claim?token=abc");
    expect(rendered).not.toMatch(/\{\{/);
  });

  it("states plainly that leads go only to the business, never sold or shared", () => {
    const body = DEFAULT_OUTREACH_TEMPLATES.outreach_preview.body.toLowerCase();
    expect(body).toMatch(/never sell or share/);
    expect(body).toMatch(/goes only to you/);
  });
});
