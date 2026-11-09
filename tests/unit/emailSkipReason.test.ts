import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emailSkipReason, type EmailGateFields } from "../../supabase/functions/_shared/directory";

/**
 * A business that is safe to email. Each test overrides only the field it is
 * about, so a new required field on EmailGateFields fails here once rather
 * than in every case — and so each case reads as "this one thing is wrong".
 */
const SENDABLE: EmailGateFields = {
  email: "office@example.com",
  email_confidence: "verified",
  email_undeliverable_at: null,
  outreach_suppressed_at: null,
};

describe("emailSkipReason", () => {
  it("returns null when nothing is wrong — safe to send", () => {
    expect(emailSkipReason(SENDABLE)).toBeNull();
  });

  it("flags a proven bounce (email_undeliverable_at) and names the timestamp", () => {
    const reason = emailSkipReason({
      ...SENDABLE,
      email_undeliverable_at: "2026-08-23T15:00:24+00:00",
    });
    expect(reason).toContain("undeliverable");
    expect(reason).toContain("2026-08-23T15:00:24+00:00");
  });

  it("flags a manual/opt-out suppression (outreach_suppressed_at)", () => {
    const reason = emailSkipReason({
      ...SENDABLE,
      outreach_suppressed_at: "2026-08-20T00:00:00+00:00",
    });
    expect(reason).toContain("suppressed");
  });

  it("prefers the bounce reason when both flags are set", () => {
    const reason = emailSkipReason({
      ...SENDABLE,
      email_undeliverable_at: "2026-08-23T15:00:24+00:00",
      outreach_suppressed_at: "2026-08-20T00:00:00+00:00",
    });
    expect(reason).toContain("undeliverable");
  });

  // ── ENH-020: confidence is an enforcement point, not just a label ────────

  it("holds a lead for an address awaiting review", () => {
    const reason = emailSkipReason({ ...SENDABLE, email_confidence: "needs_review" });
    expect(reason).toContain("needs_review");
    expect(reason).toContain("not confirmed");
  });

  it("holds a lead for an address review rejected", () => {
    expect(emailSkipReason({ ...SENDABLE, email_confidence: "rejected" })).toContain("rejected");
  });

  /**
   * The 494-row case, and the reason the gate lists unsendable values instead
   * of testing `!== "verified"`. NULL means enrichment has never looked at
   * this business — including a business that claimed its own listing and
   * typed its own address in. Suppressing those would be the opposite of the
   * intent, and would do it to the addresses we trust most.
   */
  it("does NOT hold a lead for a business enrichment has never assessed", () => {
    expect(emailSkipReason({ ...SENDABLE, email_confidence: null })).toBeNull();
  });

  it("does NOT hold a lead for an unrecognised confidence value", () => {
    expect(emailSkipReason({ ...SENDABLE, email_confidence: "something_new" })).toBeNull();
  });

  it("ranks a proven bounce above an unconfirmed address", () => {
    const reason = emailSkipReason({
      ...SENDABLE,
      email_confidence: "needs_review",
      email_undeliverable_at: "2026-08-23T15:00:24+00:00",
    });
    expect(reason).toContain("undeliverable");
  });

  // ── The lead that reached nobody and recorded nothing ────────────────────

  /**
   * Before this, a business with no address fell through submit-directory-lead's
   * `else if (business.email)` — lead stored, nobody emailed, no skip reason,
   * so invisible in the Overview's "notifications skipped" count. West Valley
   * Builders, the only claimed listing, was in exactly this state.
   */
  it("gives a reason when there is no address to notify at all", () => {
    const reason = emailSkipReason({ ...SENDABLE, email: null });
    expect(reason).toContain("no email address on file");
  });

  it("explains a rejected address rather than just its absence", () => {
    // Rejecting clears the email, so both conditions hold. The rejection is
    // the useful half — "no address" alone would not say how it got that way.
    const reason = emailSkipReason({ ...SENDABLE, email: null, email_confidence: "rejected" });
    expect(reason).toContain("rejected");
  });

  it("never returns an empty or whitespace-only reason", () => {
    const cases: EmailGateFields[] = [
      { ...SENDABLE, email_undeliverable_at: "2026-08-23T15:00:24+00:00" },
      { ...SENDABLE, outreach_suppressed_at: "2026-08-20T00:00:00+00:00" },
      { ...SENDABLE, email_confidence: "needs_review" },
      { ...SENDABLE, email: null },
    ];
    for (const c of cases) expect(emailSkipReason(c)?.trim()).toBeTruthy();
  });
});

/**
 * The gate reads `business.email_confidence` off a row fetched by an explicit
 * select list. An omitted column arrives as `undefined`, so the check would
 * never match and the gate would look correct while doing nothing at all.
 * `strict: false` is on project-wide, which erases the type, so `tsc` cannot
 * catch it. This is the only thing that can.
 */
describe("submit-directory-lead's business select", () => {
  // Resolved from the repo root rather than import.meta.url: under this
  // vitest config import.meta.url is not a file: URL, so readFileSync on it
  // throws "The URL must be of scheme file" before any test runs.
  const source = readFileSync(
    resolve(process.cwd(), "supabase/functions/submit-directory-lead/index.ts"),
    "utf8",
  );

  it("fetches every column emailSkipReason() reads", () => {
    const select = source.match(/\.from\("businesses"\)\s*\.select\(\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/);
    expect(select, "could not find the businesses select — did the query move?").not.toBeNull();

    const columns = select![1].split(",").map((c) => c.trim());
    for (const required of [
      "email",
      "email_confidence",
      "email_undeliverable_at",
      "outreach_suppressed_at",
    ]) {
      expect(columns, `select is missing ${required}, so the gate cannot see it`).toContain(required);
    }
  });
});
