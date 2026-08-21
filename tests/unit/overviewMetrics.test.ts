import { describe, it, expect } from "vitest";
import { resolveRange, mergeActivity, percentChange, type ActivityEvent } from "../../src/lib/overviewMetrics";

/**
 * These decide what period a dashboard number covers and what it is compared
 * against. A wrong window doesn't render as an error — it renders as a
 * confident, wrong percentage, which is worse than showing nothing.
 */

describe("resolveRange", () => {
  it("'today' starts at local midnight, not 24 hours ago", () => {
    // A rolling 24h window labelled "today" would quietly include yesterday
    // evening — the operator reads a calendar day, so that's what it must be.
    const now = new Date(2026, 7, 21, 14, 30); // 21 Aug 2026, 14:30 local
    const w = resolveRange("today", now);
    expect(w.since.getHours()).toBe(0);
    expect(w.since.getDate()).toBe(21);
    expect(w.until).toEqual(now);
  });

  it("compares 'today' against the same elapsed span yesterday, not all of yesterday", () => {
    // At 9am, comparing against a full 24h yesterday would always look like a
    // collapse — every morning would show a fake downward trend.
    const now = new Date(2026, 7, 21, 9, 0);
    const w = resolveRange("today", now);
    const todaySpan = w.until.getTime() - w.since.getTime();
    const prevSpan = w.prevUntil.getTime() - w.prevSince.getTime();
    expect(prevSpan).toBe(todaySpan);
    expect(w.prevSince.getDate()).toBe(20);
  });

  it("gives 7d and 30d an equal-length immediately-preceding comparison window", () => {
    const now = new Date("2026-08-21T12:00:00Z");
    for (const [preset, days] of [["7d", 7], ["30d", 30]] as const) {
      const w = resolveRange(preset, now);
      const span = w.until.getTime() - w.since.getTime();
      const prevSpan = w.prevUntil.getTime() - w.prevSince.getTime();
      expect(Math.round(span / 86_400_000)).toBe(days);
      expect(prevSpan).toBe(span);
      // The comparison window must END exactly where the current one begins —
      // any gap or overlap double-counts or drops events at the seam.
      expect(w.prevUntil.getTime()).toBe(w.since.getTime());
    }
  });

  it("labels each range in words the heading can use directly", () => {
    const now = new Date("2026-08-21T12:00:00Z");
    expect(resolveRange("today", now).label).toBe("today");
    expect(resolveRange("7d", now).label).toBe("the last 7 days");
    expect(resolveRange("30d", now).label).toBe("the last 30 days");
  });
});

describe("mergeActivity", () => {
  const ev = (id: string, at: string): ActivityEvent => ({ id, at, text: id, kind: "lead" });

  it("interleaves sources by time, newest first", () => {
    const merged = mergeActivity([
      [ev("a", "2026-08-19T00:00:00Z"), ev("c", "2026-08-21T00:00:00Z")],
      [ev("b", "2026-08-20T00:00:00Z")],
    ]);
    expect(merged.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("caps the feed", () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`e${i}`, `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    expect(mergeActivity([many], 5)).toHaveLength(5);
  });

  it("drops entries with an unparseable timestamp rather than sorting them randomly", () => {
    const merged = mergeActivity([[ev("good", "2026-08-20T00:00:00Z"), ev("bad", "not-a-date")]]);
    expect(merged.map((e) => e.id)).toEqual(["good"]);
  });

  it("returns an empty feed for empty sources", () => {
    expect(mergeActivity([[], []])).toEqual([]);
  });
});

describe("percentChange", () => {
  it("computes an ordinary change", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it("returns null when nothing happened in either period", () => {
    // "0%" would read as a measured result. Nothing happened either period —
    // there is no trend, and claiming one is a small lie on a decision screen.
    expect(percentChange(0, 0)).toBeNull();
  });

  it("treats growth from zero as +100 rather than dividing by zero", () => {
    expect(percentChange(5, 0)).toBe(100);
  });

  it("handles a drop to zero", () => {
    expect(percentChange(0, 10)).toBe(-100);
  });
});
