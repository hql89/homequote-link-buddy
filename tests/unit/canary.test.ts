import { describe, it, expect } from "vitest";
import {
  isProbeOverdue,
  shouldSendNewProbe,
  buildProbeSubject,
  extractTokenFromSubject,
  GRACE_MINUTES,
  PROBE_INTERVAL_MINUTES,
} from "../../supabase/functions/_shared/canary";

const MIN = 60_000;

describe("isProbeOverdue", () => {
  it("is not overdue immediately after sending", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    expect(isProbeOverdue(now, now)).toBe(false);
  });

  it("is not overdue at 19 minutes with the default 20-minute grace", () => {
    const sentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(sentAt.getTime() + 19 * MIN);
    expect(isProbeOverdue(sentAt, now)).toBe(false);
  });

  it("is not overdue exactly at the grace boundary — only strictly past it", () => {
    // Avoids a race against a confirmation arriving right at the edge.
    const sentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(sentAt.getTime() + GRACE_MINUTES * MIN);
    expect(isProbeOverdue(sentAt, now)).toBe(false);
  });

  it("is overdue one minute past the grace period", () => {
    const sentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(sentAt.getTime() + (GRACE_MINUTES + 1) * MIN);
    expect(isProbeOverdue(sentAt, now)).toBe(true);
  });

  it("respects a custom grace period", () => {
    const sentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(sentAt.getTime() + 6 * MIN);
    expect(isProbeOverdue(sentAt, now, 5)).toBe(true);
    expect(isProbeOverdue(sentAt, now, 10)).toBe(false);
  });
});

describe("shouldSendNewProbe", () => {
  it("is due immediately when no probe has ever been sent", () => {
    expect(shouldSendNewProbe(null, new Date())).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    const lastSentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(lastSentAt.getTime() + 59 * MIN);
    expect(shouldSendNewProbe(lastSentAt, now)).toBe(false);
  });

  it("is due once the interval has fully elapsed", () => {
    const lastSentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(lastSentAt.getTime() + PROBE_INTERVAL_MINUTES * MIN);
    expect(shouldSendNewProbe(lastSentAt, now)).toBe(true);
  });

  it("respects a custom interval", () => {
    const lastSentAt = new Date("2026-08-04T12:00:00Z");
    const now = new Date(lastSentAt.getTime() + 10 * MIN);
    expect(shouldSendNewProbe(lastSentAt, now, 15)).toBe(false);
    expect(shouldSendNewProbe(lastSentAt, now, 5)).toBe(true);
  });
});

describe("buildProbeSubject / extractTokenFromSubject", () => {
  const token = "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7";

  it("round-trips a token through the subject line", () => {
    const subject = buildProbeSubject(token);
    expect(extractTokenFromSubject(subject)).toBe(token);
  });

  it("is what the n8n watcher will actually search for", () => {
    expect(buildProbeSubject(token)).toContain("HomeQuoteLink Delivery Probe");
  });

  it("normalises extracted token casing to lowercase", () => {
    const shouted = `HomeQuoteLink Delivery Probe #${token.toUpperCase()}`;
    expect(extractTokenFromSubject(shouted)).toBe(token.toLowerCase());
  });

  it("returns null for a subject that was never a probe, rather than throwing", () => {
    // The watcher will see replies/forwards it must skip, not crash on.
    expect(extractTokenFromSubject("Re: Quick question about your listing")).toBeNull();
    expect(extractTokenFromSubject("")).toBeNull();
  });

  it("extracts the token even if it's not the only thing in the subject (a reply prefix)", () => {
    const replied = `Re: ${buildProbeSubject(token)}`;
    expect(extractTokenFromSubject(replied)).toBe(token);
  });
});
