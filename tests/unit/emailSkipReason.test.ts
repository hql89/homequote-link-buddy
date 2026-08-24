import { describe, it, expect } from "vitest";
import { emailSkipReason } from "../../supabase/functions/_shared/directory";

describe("emailSkipReason", () => {
  it("returns null when neither flag is set — safe to send", () => {
    expect(
      emailSkipReason({ email_undeliverable_at: null, outreach_suppressed_at: null }),
    ).toBeNull();
  });

  it("flags a proven bounce (email_undeliverable_at) and names the timestamp", () => {
    const reason = emailSkipReason({
      email_undeliverable_at: "2026-08-23T15:00:24+00:00",
      outreach_suppressed_at: null,
    });
    expect(reason).toContain("undeliverable");
    expect(reason).toContain("2026-08-23T15:00:24+00:00");
  });

  it("flags a manual/opt-out suppression (outreach_suppressed_at)", () => {
    const reason = emailSkipReason({
      email_undeliverable_at: null,
      outreach_suppressed_at: "2026-08-20T00:00:00+00:00",
    });
    expect(reason).toContain("suppressed");
  });

  it("prefers the bounce reason when both flags are set", () => {
    const reason = emailSkipReason({
      email_undeliverable_at: "2026-08-23T15:00:24+00:00",
      outreach_suppressed_at: "2026-08-20T00:00:00+00:00",
    });
    expect(reason).toContain("undeliverable");
  });
});
