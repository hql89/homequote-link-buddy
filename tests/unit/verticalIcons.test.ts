import { describe, it, expect } from "vitest";
import { getVerticalIcon } from "../../src/lib/verticalIcons";
import { Droplets, Wrench } from "lucide-react";

describe("getVerticalIcon", () => {
  it("resolves a known icon name", () => {
    expect(getVerticalIcon("Droplets")).toBe(Droplets);
  });

  it("falls back to Wrench for an icon name not in the map", () => {
    expect(getVerticalIcon("SomeUnmappedIcon")).toBe(Wrench);
  });

  it("falls back to Wrench for null or undefined", () => {
    expect(getVerticalIcon(null)).toBe(Wrench);
    expect(getVerticalIcon(undefined)).toBe(Wrench);
  });
});
