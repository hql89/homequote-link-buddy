import { describe, it, expect } from "vitest";
import { markPaletteIndex, markColor, markInitials, MARK_PALETTE } from "../../src/lib/businessMark";

describe("markPaletteIndex / markColor", () => {
  it("is deterministic: the same name always lands on the same entry", () => {
    const names = ["Lux Air HVAC", "Georgiy Grekov", "V Plumbing", "Perfect Electric Inc"];
    for (const name of names) {
      const first = markPaletteIndex(name);
      for (let i = 0; i < 5; i++) expect(markPaletteIndex(name)).toBe(first);
    }
  });

  it("is case- and whitespace-insensitive, since display casing can vary", () => {
    expect(markPaletteIndex("LUX AIR HVAC")).toBe(markPaletteIndex("Lux Air HVAC"));
    expect(markPaletteIndex("  Lux Air HVAC  ")).toBe(markPaletteIndex("Lux Air HVAC"));
  });

  it("spreads a realistic name list across the palette rather than clustering", () => {
    // The actual verticals distribution from the first real ingestion run.
    const names = [
      "Lux Air HVAC", "Perfect Electric Inc", "Power By Spark Inc", "RFS Electric Inc",
      "V Plumbing", "Sultani Audio Video Security", "Georgiy Grekov", "Asaf Bloch",
      "Andrew Epstein", "Rene Lopez Gomez", "Simple Water Heater", "Retrofit 1",
    ];
    const indices = new Set(names.map(markPaletteIndex));
    // Not every name needs a distinct colour, but a dozen varied names should
    // not collapse onto one or two entries.
    expect(indices.size).toBeGreaterThanOrEqual(4);
  });

  it("always returns a colour from the published palette", () => {
    for (const name of ["A", "", "Z".repeat(200), "日本語の会社"]) {
      expect(MARK_PALETTE).toContain(markColor(name));
    }
  });

  it("does not throw on an empty name", () => {
    expect(() => markColor("")).not.toThrow();
  });
});

describe("markInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(markInitials("Lux Air HVAC")).toBe("LA");
    expect(markInitials("Perfect Electric Inc")).toBe("PE");
  });

  it("takes the first two characters of a single-word name", () => {
    expect(markInitials("Retrofit")).toBe("RE");
  });

  it("handles the personal names that motivated this feature in the first place", () => {
    expect(markInitials("Georgiy Grekov")).toBe("GG");
    expect(markInitials("Rene Lopez Gomez")).toBe("RL");
  });

  it("falls back to '?' for empty or whitespace-only input rather than throwing", () => {
    expect(markInitials("")).toBe("?");
    expect(markInitials("   ")).toBe("?");
  });

  it("collapses repeated internal whitespace", () => {
    expect(markInitials("V     Plumbing")).toBe("VP");
  });
});
