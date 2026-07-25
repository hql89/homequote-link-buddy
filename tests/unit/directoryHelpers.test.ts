import { describe, it, expect } from "vitest";
import {
  slugify,
  renderTemplate,
  toE164,
  DEFAULT_OUTREACH_TEMPLATES,
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
