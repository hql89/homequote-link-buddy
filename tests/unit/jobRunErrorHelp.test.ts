import { describe, it, expect } from "vitest";
import { explainRunError } from "../../src/lib/jobRunErrorHelp";

describe("explainRunError", () => {
  it("returns null when there is no error message", () => {
    expect(explainRunError("unsubscribe", null)).toBeNull();
  });

  it("returns null for a dynamic Postgres/network message it has never seen", () => {
    expect(explainRunError("claim-listing", "Lookup failed: connection reset")).toBeNull();
  });

  it("returns null when the message is known but for a different job_name", () => {
    // "No business for token" is unsubscribe-specific; a same-text collision
    // under a different job_name must not borrow its explanation.
    expect(explainRunError("some-other-job", "No business for token")).toBeNull();
  });

  it.each([
    ["unsubscribe", "Invalid or missing token"],
    ["unsubscribe", "No business for token"],
    ["submit-directory-lead", "Business has no email on file."],
    ["ingest-business", "No active Email 1 template variant — nothing was sent. Check Admin → Outreach."],
    ["enrich-business-email", "Perplexity is not configured. Go to Admin → Settings to add a key."],
    ["enrich-business-email", "Perplexity is not enabled. Go to Admin → Settings."],
    ["publish-scheduled-posts", "Unknown error"],
  ])("explains the known %s / %s message", (jobName, message) => {
    const explanation = explainRunError(jobName, message);
    expect(explanation).toEqual(expect.any(String));
    expect(explanation!.length).toBeGreaterThan(0);
  });

  it("matches the send-outreach-drip Email 1 fragment even joined with other (dynamic) text", () => {
    const joined = "Email 1 skipped: no active template variant. | row-123 (email 1): timeout";
    expect(explainRunError("send-outreach-drip", joined)).toMatch(/Email 1/);
  });

  it("matches the send-outreach-drip Email 2 fragment even joined with other (dynamic) text", () => {
    const joined = "Email 2 skipped: no active template variant. | row-456 (email 2): timeout";
    expect(explainRunError("send-outreach-drip", joined)).toMatch(/Email 2/);
  });

  it("distinguishes the Email 1 and Email 2 outreach explanations", () => {
    const e1 = explainRunError("send-outreach-drip", "Email 1 skipped: no active template variant.");
    const e2 = explainRunError("send-outreach-drip", "Email 2 skipped: no active template variant.");
    expect(e1).not.toEqual(e2);
  });
});
