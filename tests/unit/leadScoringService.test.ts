import { describe, it, expect } from "vitest";
import { scoreLead } from "../../src/services/leadScoringService";

/**
 * Regression test for a bug surfaced while retiring the hardcoded VERTICALS
 * map: scoreServiceType used to guess a vertical from the service type
 * string via verticalFromServiceType(), which only recognized tree-service
 * types and silently fell through to the tree-service point table for
 * everything else — so every non-tree-service lead (plumbing, HVAC,
 * electrical, landscaping) scored exactly 0 on this dimension, identical to
 * a *recognized* low-intent tree-service type ("Other": 0). That made
 * "not yet scored" indistinguishable from "known and low-intent".
 *
 * It must now get a documented neutral placeholder instead.
 */

const baseLead = {
  urgency: "flexible", // 0 points
  email: undefined, // 0 points
  description: "", // 0 points
  utm_source: "test", // non-empty + no gclid = 0 points (see scoreSourceQuality)
  // All four other scoring dimensions neutralized so only the
  // service-type score under test contributes to the total.
};

describe("scoreLead — service type scoring", () => {
  it("scores a recognized tree-service type using the real point table", () => {
    const score = scoreLead({ ...baseLead, service_type: "Emergency Tree Removal" });
    expect(score).toBe(20);
  });

  it("gives a non-tree-service type a neutral placeholder, not 0", () => {
    const plumbing = scoreLead({ ...baseLead, service_type: "Drain Cleaning" });
    const hvac = scoreLead({ ...baseLead, service_type: "AC Repair" });

    expect(plumbing).toBe(10);
    expect(hvac).toBe(10);
    // Must not be conflated with the tree-service table's real "low intent"
    // score of 0 (e.g. its own "Other" entry).
    expect(plumbing).not.toBe(0);
  });

  it("still scores a recognized low-intent tree-service type as 0, distinctly from unscored types", () => {
    const score = scoreLead({ ...baseLead, service_type: "Other" });
    expect(score).toBe(0);
  });
});
