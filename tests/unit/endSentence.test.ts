import { describe, it, expect } from "vitest";
import { endSentence } from "../../src/lib/businessMark";

/**
 * "West Valley Builders Inc." is a real registered name, and the quote form
 * rendered "...straight to West Valley Builders Inc.." on its live page.
 * One of 537 published listings ends in a period today, but incorporated
 * names routinely do, so this recurs as the directory grows.
 */
describe("endSentence", () => {
  it("adds the full stop a plain name needs", () => {
    expect(endSentence("La Techs LLC")).toBe("La Techs LLC. ");
  });

  it("does not double a full stop the name already ends with", () => {
    expect(endSentence("West Valley Builders Inc.")).toBe("West Valley Builders Inc. ");
    expect(endSentence("West Valley Builders Inc.")).not.toContain("..");
  });

  it("leaves other terminal punctuation alone", () => {
    expect(endSentence("Who Fixes It?")).toBe("Who Fixes It? ");
    expect(endSentence("Fix It Now!")).toBe("Fix It Now! ");
  });

  it("trims stray whitespace rather than punctuating after it", () => {
    expect(endSentence("  Ameco Solar LLC  ")).toBe("Ameco Solar LLC. ");
    expect(endSentence("West Valley Builders Inc. ")).toBe("West Valley Builders Inc. ");
  });

  it("always ends with a single trailing space, so the next sentence is spaced", () => {
    for (const n of ["A Co", "A Co.", "A Co?", "  A Co  "]) {
      expect(endSentence(n)).toMatch(/[^ ] $/);
    }
  });
});
