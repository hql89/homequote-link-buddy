import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Both buttons in /admin/enrichment's review queue shipped broken: the columns
 * they write had no UPDATE grant for `authenticated`, so every click failed
 * with "permission denied for table businesses". That was the third time this
 * class of bug reached production (is_published, then the reply actions, then
 * this), so the guard here is against the *recurrence*, not the instance.
 *
 * A mocked client cannot enforce a Postgres grant, so this does not re-test
 * the permission itself — it pins the exact column set each decision writes.
 * Adding a field to either payload breaks these assertions, which point at
 * 20260731130000_admin_enrichment_review_grants.sql: the grant has to grow
 * with the payload or the button dies in production and nowhere else.
 *
 * It has since done its job once: the email_review_* columns below were added
 * to the dismiss payload on 2026-08-20 and these assertions failed until
 * 20260820030000_enrichment_review_assessment.sql granted them. Verified
 * against production with has_column_privilege before this list was widened —
 * widen it only after confirming the grant exists, never to make a red test
 * green.
 */
const GRANTED_UPDATE_COLUMNS = [
  "email",
  "email_source_url",
  "email_source_phone",
  "email_source_address",
  "email_confidence",
  // Granted by 20260820030000_enrichment_review_assessment.sql.
  "email_review_verdict",
  "email_review_notes",
  "email_review_assessed_at",
] as const;

const calls: { values: Record<string, unknown>; id: string }[] = [];
const nextError = { value: null as { message: string } | null };

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          calls.push({ values, id });
          return Promise.resolve({ error: nextError.value });
        },
        in: () => Promise.resolve({ error: null }),
      }),
    }),
  },
}));

const { reviewEnrichedEmail } = await import("../../src/integrations/supabase/directory");

describe("reviewEnrichedEmail", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
  });

  it("confirming promotes the row to verified and touches nothing else", async () => {
    await reviewEnrichedEmail("biz-1", "verified");
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual({ email_confidence: "verified" });
    expect(calls[0].id).toBe("biz-1");
  });

  it("dismissing clears the whole discovered payload, not just the email", async () => {
    // A rejected row keeping its scraped phone/address is how stale contact
    // data gets re-trusted by a later reader who only checks `email`.
    await reviewEnrichedEmail("biz-2", "rejected");
    expect(calls[0].values).toEqual({
      email: null,
      email_source_url: null,
      email_source_phone: null,
      email_source_address: null,
      email_confidence: "rejected",
      // The automated assessment is reasoning about the evidence being cleared
      // above it. Kept, it would be a verdict about nothing — and would
      // resurface stale if this row were re-enriched and re-queued later.
      email_review_verdict: null,
      email_review_notes: null,
      email_review_assessed_at: null,
    });
  });

  it("never writes a column outside the granted set", async () => {
    await reviewEnrichedEmail("biz-3", "verified");
    await reviewEnrichedEmail("biz-4", "rejected");
    for (const call of calls) {
      for (const column of Object.keys(call.values)) {
        expect(GRANTED_UPDATE_COLUMNS).toContain(column);
      }
    }
  });

  it("never clears enriched_at, which would put a dismissed row back in the queue", async () => {
    await reviewEnrichedEmail("biz-5", "rejected");
    expect(calls[0].values).not.toHaveProperty("enriched_at");
  });

  it("returns the error rather than swallowing it, so the UI can surface it", async () => {
    nextError.value = { message: "permission denied for table businesses" };
    const error = await reviewEnrichedEmail("biz-6", "rejected");
    expect(error?.message).toBe("permission denied for table businesses");
  });
});
