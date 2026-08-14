import { describe, it, expect } from "vitest";
import {
  pickVariant,
  remainingDailyBudget,
  startOfUtcDay,
  type TemplateVariant,
} from "../../supabase/functions/_shared/outreachVariants";
import { looksLikeItContainsLink, renderPreview } from "../../src/lib/outreachCopy";

/**
 * These two pieces of arithmetic decide how many real cold emails go out and
 * which copy they carry. The cap in particular replaces a constant that was
 * applied per invocation — under which "limit 50" meant 100 emails if the
 * job ran twice in a day. The whole point of the rewrite is that the number
 * an admin types is the number of emails that get sent, so it is tested
 * directly rather than through the edge function.
 */

function variant(over: Partial<TemplateVariant> = {}): TemplateVariant {
  return {
    variant_key: "A",
    subject: "s",
    body: "b",
    weight: 1,
    is_active: true,
    ...over,
  };
}

describe("remainingDailyBudget", () => {
  it("gives the full limit when nothing has been sent today", () => {
    expect(remainingDailyBudget(10, 0)).toBe(10);
  });

  it("subtracts what has already gone out today — the multi-run case", () => {
    // The exact scenario the old per-invocation BATCH_LIMIT got wrong: a
    // second run on the same day must see a reduced allowance, not a fresh one.
    expect(remainingDailyBudget(10, 4)).toBe(6);
  });

  it("returns zero once the limit is reached exactly", () => {
    expect(remainingDailyBudget(10, 10)).toBe(0);
  });

  it("never goes negative when the limit is lowered below today's count", () => {
    // Admin sends 10, then lowers the limit to 3. Sending must stop, and the
    // caller passes this straight into .limit() — a negative would be worse
    // than useless there.
    expect(remainingDailyBudget(3, 10)).toBe(0);
  });

  it("treats a zero or negative limit as send nothing", () => {
    expect(remainingDailyBudget(0, 0)).toBe(0);
    expect(remainingDailyBudget(-5, 0)).toBe(0);
  });

  it("ignores a non-finite limit rather than sending unboundedly", () => {
    expect(remainingDailyBudget(Number.NaN, 0)).toBe(0);
    expect(remainingDailyBudget(Number.POSITIVE_INFINITY, 0)).toBe(0);
  });

  it("floors fractional input so the cap can't be fudged upward", () => {
    expect(remainingDailyBudget(10.9, 0)).toBe(10);
  });
});

describe("startOfUtcDay", () => {
  it("returns midnight UTC of the given instant", () => {
    expect(startOfUtcDay(new Date("2026-08-14T17:43:11.222Z"))).toBe("2026-08-14T00:00:00.000Z");
  });

  it("does not roll back a day for a late-evening UTC time", () => {
    // A local-timezone implementation would land on the 13th for a US-Pacific
    // machine here, quietly giving the job a second day's allowance.
    expect(startOfUtcDay(new Date("2026-08-14T23:59:59.999Z"))).toBe("2026-08-14T00:00:00.000Z");
  });

  it("is stable at exactly midnight", () => {
    expect(startOfUtcDay(new Date("2026-08-14T00:00:00.000Z"))).toBe("2026-08-14T00:00:00.000Z");
  });
});

describe("pickVariant", () => {
  it("returns null when every variant is inactive", () => {
    // The caller must skip the stage entirely here. Returning a variant would
    // mean mailing copy the admin deliberately switched off.
    expect(pickVariant([variant({ is_active: false }), variant({ variant_key: "B", is_active: false })])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickVariant([])).toBeNull();
  });

  it("returns null when the only active variant has zero weight", () => {
    expect(pickVariant([variant({ weight: 0 })])).toBeNull();
  });

  it("never selects an inactive variant", () => {
    const chosen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const v = pickVariant([
        variant({ variant_key: "A", is_active: true }),
        variant({ variant_key: "B", is_active: false }),
      ]);
      if (v) chosen.add(v.variant_key);
    }
    expect(chosen).toEqual(new Set(["A"]));
  });

  it("splits evenly between two equally weighted variants", () => {
    const counts: Record<string, number> = { A: 0, B: 0 };
    // Deterministic sweep across [0,1) instead of real randomness, so this
    // asserts the bucket boundaries rather than a flaky sample.
    for (let i = 0; i < 1000; i++) {
      const v = pickVariant(
        [variant({ variant_key: "A" }), variant({ variant_key: "B" })],
        () => i / 1000,
      )!;
      counts[v.variant_key]++;
    }
    expect(counts.A).toBe(500);
    expect(counts.B).toBe(500);
  });

  it("respects relative weights", () => {
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 1000; i++) {
      const v = pickVariant(
        [variant({ variant_key: "A", weight: 3 }), variant({ variant_key: "B", weight: 1 })],
        () => i / 1000,
      )!;
      counts[v.variant_key]++;
    }
    expect(counts.A).toBe(750);
    expect(counts.B).toBe(250);
  });

  it("returns a real variant even if the random source yields 1", () => {
    const v = pickVariant([variant({ variant_key: "A" }), variant({ variant_key: "B" })], () => 1);
    expect(v).not.toBeNull();
    expect(["A", "B"]).toContain(v!.variant_key);
  });
});

describe("looksLikeItContainsLink", () => {
  it("flags an http or https URL", () => {
    expect(looksLikeItContainsLink("see https://example.com now")).toBe(true);
    expect(looksLikeItContainsLink("see http://example.com now")).toBe(true);
  });

  it("flags a bare www. host", () => {
    expect(looksLikeItContainsLink("visit www.example.com")).toBe(true);
  });

  it("flags the claim_url merge field, which renders as a link", () => {
    expect(looksLikeItContainsLink("Here it is: {{claim_url}}")).toBe(true);
  });

  it("does not flag the link-free Email 1 copy", () => {
    expect(
      looksLikeItContainsLink(
        "Hi {{owner_name}},\n\nI want to make sure your phone number ({{phone}}) is correct.\n\nBest,\n{{sender_name}}",
      ),
    ).toBe(false);
  });

  it("does not flag an email address as a link", () => {
    expect(looksLikeItContainsLink("reply to admin@homequotelink.com")).toBe(false);
  });
});

describe("renderPreview", () => {
  it("substitutes known merge fields", () => {
    expect(renderPreview("Hi {{owner_name}} at {{business_name}}", {
      owner_name: "Dana",
      business_name: "Valley Roofing",
    })).toBe("Hi Dana at Valley Roofing");
  });

  it("tolerates whitespace inside the braces, like the sender does", () => {
    expect(renderPreview("Hi {{ owner_name }}", { owner_name: "Dana" })).toBe("Hi Dana");
  });

  it("marks an unknown field visibly instead of silently blanking it", () => {
    // The send path renders an unknown field as "". Showing that in a preview
    // would hide a typo'd merge field at exactly the moment it's fixable.
    expect(renderPreview("Hi {{ownr_name}}", { owner_name: "Dana" })).toBe("Hi [unknown: ownr_name]");
  });
});
