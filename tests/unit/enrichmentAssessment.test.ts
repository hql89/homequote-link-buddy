import { describe, it, expect } from "vitest";
import {
  buildAssessmentPrompt,
  extractReadableText,
  formatClasses,
  parseAssessment,
} from "../../supabase/functions/_shared/enrichmentAssessment";

/**
 * These back an advisory verdict shown to a human on the enrichment review
 * queue. The parser is the load-bearing part: it decides whether a model's
 * reply becomes text on that screen at all, and a half-read or defaulted
 * verdict would put words in the model's mouth on the exact screen someone is
 * using to decide whether to cold-email a stranger.
 */

const FACTS = {
  businessName: "Wild Flora Design Inc",
  city: "Studio City",
  cslbPhone: "+18185227150",
  trade: "landscaping",
  classification: "B| C27",
  sourceUrl: "https://wildfloradesign.com/",
};

describe("extractReadableText", () => {
  it("strips tags, scripts and styles down to visible words", () => {
    const html =
      "<html><head><style>.a{color:red}</style><script>var x=1;</script></head>" +
      "<body><h1>Wild Flora</h1><p>Floral design</p></body></html>";
    const text = extractReadableText(html);

    expect(text).toContain("Wild Flora");
    expect(text).toContain("Floral design");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var x");
  });

  it("decodes the entities that would otherwise litter the text", () => {
    expect(extractReadableText("<p>Smith&nbsp;&amp;&nbsp;Sons</p>")).toBe("Smith & Sons");
  });

  it("keeps both ends when the page is too long, because the footer decides", () => {
    // Address, licence number and phone almost always live in the footer, so
    // a head-only truncation would discard the half that most often settles
    // identity. HEAD and TAIL must both survive.
    const html = `<p>HEADMARKER</p><p>${"filler ".repeat(4000)}</p><p>TAILMARKER</p>`;
    const text = extractReadableText(html, 400);

    expect(text).toContain("HEADMARKER");
    expect(text).toContain("TAILMARKER");
    expect(text.length).toBeLessThan(600);
  });

  it("leaves a short page untruncated and unmarked", () => {
    expect(extractReadableText("<p>Short page</p>", 400)).toBe("Short page");
  });
});

describe("buildAssessmentPrompt", () => {
  it("carries every licence fact the judgement depends on", () => {
    const prompt = buildAssessmentPrompt(FACTS, "some page text");

    expect(prompt).toContain("Wild Flora Design Inc");
    expect(prompt).toContain("Studio City");
    expect(prompt).toContain("landscaping");
    expect(prompt).toContain("https://wildfloradesign.com/");
    expect(prompt).toContain("some page text");
  });

  it("tells the model a differing phone is NOT evidence of a mismatch", () => {
    // Without this the model just re-derives the phone check the code already
    // did and reports the mismatch that put the row in the queue — which reads
    // as independent confirmation while being nothing of the sort. Every row a
    // human confirmed on 2026-08-19 had a non-matching phone.
    const prompt = buildAssessmentPrompt(FACTS, "text");
    expect(prompt).toMatch(/NOT evidence of a\s*\n?mismatch/i);
  });

  it("confines the model to the supplied text", () => {
    const prompt = buildAssessmentPrompt(FACTS, "text");
    expect(prompt).toMatch(/Judge ONLY from the text below/i);
    expect(prompt).toMatch(/Do not use outside knowledge/i);
  });

  it("survives a missing trade and phone without printing 'null'", () => {
    const prompt = buildAssessmentPrompt(
      { ...FACTS, trade: null, cslbPhone: null },
      "text",
    );
    expect(prompt).not.toContain("null");
    expect(prompt).toContain("unknown");
  });
});

describe("parseAssessment", () => {
  it("reads a well-formed reply", () => {
    const result = parseAssessment(
      "VERDICT: likely_mismatch\nREASON: The site is a florist selling bouquets, which does not fit a landscaping licence.",
    );
    expect(result).toEqual({
      verdict: "likely_mismatch",
      notes:
        "The site is a florist selling bouquets, which does not fit a landscaping licence.",
    });
  });

  it("accepts each verdict value", () => {
    expect(parseAssessment("VERDICT: likely_match\nREASON: Name and city align.")?.verdict).toBe(
      "likely_match",
    );
    expect(parseAssessment("VERDICT: unclear\nREASON: Page has almost no text.")?.verdict).toBe(
      "unclear",
    );
  });

  it("is case-insensitive and tolerates surrounding chatter", () => {
    const result = parseAssessment(
      "Sure, here is my read.\nverdict: LIKELY_MATCH\nreason: Address on the page is in Studio City.",
    );
    expect(result?.verdict).toBe("likely_match");
    expect(result?.notes).toBe("Address on the page is in Studio City.");
  });

  it("collapses a multi-line reason into one readable line", () => {
    const result = parseAssessment("VERDICT: unclear\nREASON: Line one\n   and line two.");
    expect(result?.notes).toBe("Line one and line two.");
  });

  it("returns null when there is no parseable verdict", () => {
    // Storing a defaulted verdict here would fabricate an opinion on the very
    // screen someone uses to decide. Absent is honest; invented is not.
    expect(parseAssessment("I think this is probably the right business.")).toBeNull();
    expect(parseAssessment("")).toBeNull();
    expect(parseAssessment("VERDICT: maybe\nREASON: unsure")).toBeNull();
  });

  it("returns null when a verdict arrives with no reasoning", () => {
    // A bare verdict with nothing to justify it is worse than none — it looks
    // authoritative and shows no work.
    expect(parseAssessment("VERDICT: likely_match")).toBeNull();
    expect(parseAssessment("VERDICT: likely_match\nREASON:   ")).toBeNull();
  });

  it("caps runaway reasoning so the card stays scannable", () => {
    const result = parseAssessment(`VERDICT: unclear\nREASON: ${"word ".repeat(400)}`);
    expect(result!.notes.length).toBeLessThanOrEqual(500);
  });
});

describe("formatClasses", () => {
  it("expands the codes, because C22 means nothing to a reader that has not been told", () => {
    expect(formatClasses("B| C10| C22")).toBe(
      "B (general building), C10 (electrical), C22 (asbestos abatement)",
    );
  });

  it("passes through a code it does not recognise rather than dropping it", () => {
    // Silently swallowing an unknown class would understate the licence and
    // reintroduce the false mismatch this field exists to prevent.
    expect(formatClasses("C10| C99")).toBe("C10 (electrical), C99");
  });

  it("returns null for nothing, so the caller can fall back", () => {
    expect(formatClasses(null)).toBeNull();
    expect(formatClasses("   ")).toBeNull();
  });
});

describe("buildAssessmentPrompt — multi-class licences", () => {
  it("shows every class held, not just the display vertical", () => {
    // The real 2026-08-20 false negative: filed under "electrical", flagged as
    // a mismatch for doing asbestos work its C22 class plainly covers.
    const prompt = buildAssessmentPrompt(
      {
        businessName: "Lucy Asbestos Abatement",
        city: "Encino",
        cslbPhone: null,
        trade: "electrical",
        classification: "B| C10| C20| C22| C27| C36",
        sourceUrl: "https://www.lucyenv.com/",
      },
      "asbestos and environmental services",
    );

    expect(prompt).toContain("C22 (asbestos abatement)");
    expect(prompt).toContain("C10 (electrical)");
    expect(prompt).toMatch(/services matching just one are\s*\n?a fit, not a mismatch/i);
  });

  it("falls back to the single trade when no classification is stored", () => {
    const prompt = buildAssessmentPrompt({ ...FACTS, classification: null }, "text");
    expect(prompt).toContain("landscaping");
    expect(prompt).not.toContain("null");
  });
});
