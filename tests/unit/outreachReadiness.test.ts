import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  computeOutreachReadiness,
  DELIVERY_PROOF_MAX_AGE_DAYS,
  type ReadinessInput,
} from "../../src/lib/outreachReadiness";

/**
 * This panel exists because "what's left before outreach can start?" was asked
 * four times in one session and took reading four screens plus the database to
 * answer. Its whole value is being trustworthy at a glance, so the properties
 * that matter are: it never says "ready" when the job would refuse to send, it
 * names the FIRST real blocker, and it never states as fact something it
 * couldn't read.
 */

const NOW = new Date("2026-08-20T12:00:00Z");

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    deliveryVerifiedAt: "2026-08-19T12:00:00Z",
    now: NOW,
    activeVerifyVariants: 1,
    activePreviewVariants: 1,
    eligibleBusinesses: 5,
    pausedWithEmail: 0,
    needsReview: 0,
    cronActive: true,
    dailyLimit: 10,
    sentToday: 0,
    bccEmail: null,
    ...over,
  };
}

const check = (r: ReturnType<typeof computeOutreachReadiness>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("delivery proof", () => {
  it("blocks when nobody has ever confirmed delivery", () => {
    const r = computeOutreachReadiness(input({ deliveryVerifiedAt: null }));
    expect(r.level).toBe("blocked");
    expect(check(r, "delivery").level).toBe("blocked");
    expect(check(r, "delivery").action?.href).toBe("/admin/settings");
  });

  it("blocks once the proof is older than the sending gate allows", () => {
    const r = computeOutreachReadiness(input({ deliveryVerifiedAt: "2026-08-01T12:00:00Z" }));
    expect(check(r, "delivery").level).toBe("blocked");
    expect(r.headline).toBe("Outreach is not sending");
  });

  it("warns before it lapses, rather than only after", () => {
    // 12 days old: still valid, but 2 days from expiry. Silence here would let
    // sending stop overnight with no warning.
    const r = computeOutreachReadiness(input({ deliveryVerifiedAt: "2026-08-08T12:00:00Z" }));
    expect(check(r, "delivery").level).toBe("attention");
    expect(check(r, "delivery").detail).toMatch(/Expires in 2 days/);
  });

  it("is quiet when the proof is comfortably fresh", () => {
    expect(check(computeOutreachReadiness(input()), "delivery").level).toBe("ok");
  });

  it("pins the expiry window to the sending gate it mirrors", () => {
    // Duplicated across the Deno/Vite boundary out of necessity. If they drift,
    // the panel reports "ready" while the job refuses to send — the single
    // worst failure this component can have.
    const fn = readFileSync("supabase/functions/send-outreach-drip/index.ts", "utf8");
    const match = fn.match(/DELIVERY_PROOF_MAX_AGE_DAYS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(DELIVERY_PROOF_MAX_AGE_DAYS);
  });
});

describe("copy", () => {
  it("blocks when a stage has no active version, naming which one", () => {
    const r = computeOutreachReadiness(input({ activeVerifyVariants: 0 }));
    expect(check(r, "copy").level).toBe("blocked");
    expect(check(r, "copy").detail).toContain("Email 1");
    expect(check(r, "copy").detail).not.toContain("Email 2");
  });

  it("names both stages when both are switched off", () => {
    const r = computeOutreachReadiness(input({ activeVerifyVariants: 0, activePreviewVariants: 0 }));
    expect(check(r, "copy").detail).toContain("Email 1 and Email 2");
  });
});

describe("recipients", () => {
  it("blocks at zero eligible, and points at the businesses one click away", () => {
    const r = computeOutreachReadiness(input({ eligibleBusinesses: 0, pausedWithEmail: 14 }));
    expect(check(r, "recipients").level).toBe("blocked");
    expect(check(r, "recipients").detail).toContain("14 businesses are ready but still switched off");
  });

  it("falls back to the review queue when nothing is merely paused", () => {
    const r = computeOutreachReadiness(input({ eligibleBusinesses: 0, pausedWithEmail: 0, needsReview: 3 }));
    expect(check(r, "recipients").detail).toContain("3 awaiting review");
  });

  it("says plainly when there is simply nothing found yet", () => {
    const r = computeOutreachReadiness(input({ eligibleBusinesses: 0, pausedWithEmail: 0, needsReview: 0 }));
    expect(check(r, "recipients").detail).toContain("No business has a verified email address yet");
  });

  it("still offers to switch more on when some are eligible and some are not", () => {
    const r = computeOutreachReadiness(input({ eligibleBusinesses: 2, pausedWithEmail: 12 }));
    expect(check(r, "recipients").level).toBe("ok");
    expect(check(r, "recipients").action?.href).toBe("/admin/enrichment");
  });
});

describe("schedule", () => {
  it("treats an unreadable schedule as unknown, never as off", () => {
    // Reporting "off" for something nobody could read is the same class of
    // false confidence the Background Jobs panel already guards against.
    const r = computeOutreachReadiness(input({ cronActive: null }));
    expect(check(r, "schedule").level).toBe("attention");
    expect(check(r, "schedule").detail).toMatch(/could not be read/i);
  });

  it("does not call a switched-off schedule a blocker, because Run now works", () => {
    const r = computeOutreachReadiness(input({ cronActive: false }));
    expect(check(r, "schedule").level).toBe("attention");
    expect(r.level).not.toBe("blocked");
    expect(r.headline).toBe("Ready, but only when you press Run now");
  });
});

describe("headline", () => {
  it("says it is live only when nothing blocks and the schedule is on", () => {
    const r = computeOutreachReadiness(input());
    expect(r.level).toBe("ok");
    expect(r.headline).toBe("Outreach is live");
    expect(r.sublabel).toContain("10 still available today");
  });

  it("counts multiple blockers rather than only mentioning one", () => {
    const r = computeOutreachReadiness(
      input({ deliveryVerifiedAt: null, eligibleBusinesses: 0, activeVerifyVariants: 0 }),
    );
    expect(r.sublabel).toContain("3 things are in the way");
  });

  it("names the single blocker when there is exactly one", () => {
    const r = computeOutreachReadiness(input({ eligibleBusinesses: 0 }));
    expect(r.sublabel).toContain("One thing is in the way");
  });
});

describe("allowance and testing copy", () => {
  it("flags an exhausted daily limit without calling it a blocker", () => {
    // Not a fault — it resets tomorrow, and calling it "blocked" would cry wolf.
    const r = computeOutreachReadiness(input({ dailyLimit: 2, sentToday: 2 }));
    expect(check(r, "allowance").level).toBe("attention");
    expect(check(r, "allowance").detail).toMatch(/All 2 of today's emails have been sent/);
    expect(r.level).not.toBe("blocked");
  });

  it("never shows a negative allowance if the limit was lowered after sending", () => {
    const r = computeOutreachReadiness(input({ dailyLimit: 2, sentToday: 9 }));
    expect(check(r, "allowance").detail).not.toContain("-");
  });

  it("warns while testing copies are still switched on, naming the address", () => {
    const r = computeOutreachReadiness(input({ bccEmail: "dgarcia89@gmail.com" }));
    expect(check(r, "bcc").detail).toContain("dgarcia89@gmail.com");
  });

  it("says nothing about testing copies when they are off", () => {
    expect(computeOutreachReadiness(input()).checks.find((c) => c.id === "bcc")).toBeUndefined();
  });
});
