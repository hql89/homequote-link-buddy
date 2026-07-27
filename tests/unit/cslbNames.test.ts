import { describe, it, expect } from "vitest";
import {
  titleCaseName,
  isPersonalName,
  displayBusinessName,
} from "../../supabase/functions/_shared/cslbNames";

describe("titleCaseName", () => {
  it("title-cases the ordinary case", () => {
    expect(titleCaseName("PERFECT ELECTRIC INC")).toBe("Perfect Electric Inc");
    expect(titleCaseName("POWER BY SPARK INC")).toBe("Power By Spark Inc");
    expect(titleCaseName("V PLUMBING")).toBe("V Plumbing");
  });

  it("keeps known acronyms upper case", () => {
    expect(titleCaseName("LUX AIR HVAC")).toBe("Lux Air HVAC");
    expect(titleCaseName("SoCal AC REPAIR")).toBe("Socal AC Repair");
    expect(titleCaseName("VALLEY HVAC LLC")).toBe("Valley HVAC LLC");
  });

  it("capitalises both sides of hyphens and slashes", () => {
    expect(titleCaseName("AIR-CON SERVICES")).toBe("Air-Con Services");
    expect(titleCaseName("HEATING/COOLING PROS")).toBe("Heating/Cooling Pros");
  });

  it("handles the usual surname quirks", () => {
    expect(titleCaseName("MCDONALD PLUMBING")).toBe("McDonald Plumbing");
    expect(titleCaseName("O'BRIEN ELECTRIC")).toBe("O'Brien Electric");
  });

  it("does not capitalise the s in a possessive", () => {
    expect(titleCaseName("JOHN'S PLUMBING")).toBe("John's Plumbing");
  });

  it("leaves tokens containing digits intact", () => {
    expect(titleCaseName("RETROFIT 1")).toBe("Retrofit 1");
    expect(titleCaseName("24/7 PLUMBING")).toBe("24/7 Plumbing");
  });

  it("preserves a single-letter middle initial", () => {
    expect(titleCaseName("ROBERT C TREJO")).toBe("Robert C Trejo");
  });

  it("collapses to empty for empty input", () => {
    expect(titleCaseName("")).toBe("");
    expect(titleCaseName("   ")).toBe("");
  });
});

describe("isPersonalName", () => {
  // CSLB populates FullBusinessName for two unrelated reasons; only the Sole
  // Owner case means business_name is a person written surname-first.
  it("is true for a sole owner with a full name recorded", () => {
    expect(isPersonalName({ BusinessType: "Sole Owner", FullBusinessName: "GEORGIY GREKOV" })).toBe(true);
  });

  it("is false for a corporation, whose FullBusinessName is the long legal form", () => {
    expect(
      isPersonalName({
        BusinessType: "Corporation",
        FullBusinessName: "LUX AIR ENGINEERING INC DBA LUX AIR HVAC",
      }),
    ).toBe(false);
  });

  it("is false for a sole owner trading under a business name", () => {
    expect(isPersonalName({ BusinessType: "Sole Owner", FullBusinessName: "" })).toBe(false);
    expect(isPersonalName({ BusinessType: "Sole Owner" })).toBe(false);
  });

  it("is false for missing or empty metadata", () => {
    expect(isPersonalName(null)).toBe(false);
    expect(isPersonalName({})).toBe(false);
  });
});

describe("displayBusinessName", () => {
  // The four that actually landed in the directory on the first real run.
  it("reorders a surname-first personal name using CSLB's own field", () => {
    const cases: [string, string, string][] = [
      ["GREKOV GEORGIY", "GEORGIY GREKOV", "Georgiy Grekov"],
      ["BLOCH ASAF", "ASAF BLOCH", "Asaf Bloch"],
      ["EPSTEIN ANDREW", "ANDREW EPSTEIN", "Andrew Epstein"],
      ["LOPEZ GOMEZ RENE", "RENE LOPEZ GOMEZ", "Rene Lopez Gomez"],
    ];
    for (const [stored, full, expected] of cases) {
      expect(displayBusinessName(stored, { BusinessType: "Sole Owner", FullBusinessName: full })).toBe(expected);
    }
  });

  it("never substitutes a corporation's long legal form for its trading name", () => {
    expect(
      displayBusinessName("LUX AIR HVAC", {
        BusinessType: "Corporation",
        FullBusinessName: "LUX AIR ENGINEERING INC DBA LUX AIR HVAC",
      }),
    ).toBe("Lux Air HVAC");

    expect(
      displayBusinessName("SIMPLE WATER HEATER", {
        BusinessType: "Corporation",
        FullBusinessName: "PIPE DOCTORS PLUMBING INC DBA SIMPLE WATER HEATER",
      }),
    ).toBe("Simple Water Heater");
  });

  it("title-cases a sole owner's trading name without reordering it", () => {
    expect(displayBusinessName("JR MAYORGA WOODWORKING", { BusinessType: "Sole Owner", FullBusinessName: "" }))
      .toBe("Jr Mayorga Woodworking");
  });

  it("falls back to the stored name when metadata is missing", () => {
    expect(displayBusinessName("V PLUMBING", null)).toBe("V Plumbing");
    expect(displayBusinessName("V PLUMBING", {})).toBe("V Plumbing");
  });

  it("falls back rather than emitting an empty name if FullBusinessName is blank", () => {
    expect(displayBusinessName("GREKOV GEORGIY", { BusinessType: "Sole Owner", FullBusinessName: "   " }))
      .toBe("Grekov Georgiy");
  });
});
