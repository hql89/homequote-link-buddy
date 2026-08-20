import { describe, it, expect } from "vitest";
import { summariseRun, topRejectionReason } from "../../src/lib/jobRunSummary";

describe("summariseRun — import-ingest-queue", () => {
  // These are the exact metadata shapes logged by the real production runs.
  it("summarises a full chunk that queued everything", () => {
    expect(summariseRun("import-ingest-queue", { received: 500, inserted: 500, duplicates: 0, rejected: {} }))
      .toEqual({ text: "500 queued", noChange: false });
  });

  it("flags a run that queued nothing because everything was a duplicate", () => {
    expect(summariseRun("import-ingest-queue", { received: 1, inserted: 0, duplicates: 1, rejected: {} }))
      .toEqual({ text: "0 queued · 1 already queued", noChange: true });
  });

  it("counts rejections across every reason", () => {
    const { text } = summariseRun("import-ingest-queue", {
      received: 10,
      inserted: 7,
      duplicates: 0,
      rejected: { "city not configured": 2, "unusable phone": 1 },
    });
    expect(text).toBe("7 queued · 3 rejected");
  });

  it("does not claim no-change when rows were inserted", () => {
    const { noChange } = summariseRun("import-ingest-queue", {
      received: 3, inserted: 2, duplicates: 0, rejected: { "city not configured": 1 },
    });
    expect(noChange).toBe(false);
  });
});

describe("summariseRun — process-ingest-queue", () => {
  it("summarises a run that added businesses", () => {
    expect(summariseRun("process-ingest-queue", { considered: 2, ingested: 2, skipped: 0, failed: 0, limit: 25 }))
      .toEqual({ text: "2 added", noChange: false });
  });

  it("distinguishes an empty queue from a run that did work", () => {
    expect(summariseRun("process-ingest-queue", { considered: 0, ingested: 0, skipped: 0, failed: 0, limit: 25 }))
      .toEqual({ text: "nothing pending", noChange: true });
  });

  it("reports the engine being switched off, which is not the same as an empty queue", () => {
    expect(summariseRun("process-ingest-queue", { skipped: "disabled" }))
      .toEqual({ text: "engine off — nothing processed", noChange: true });
  });

  it("surfaces skipped and failed counts alongside the additions", () => {
    const { text } = summariseRun("process-ingest-queue", {
      considered: 10, ingested: 6, skipped: 3, failed: 1, limit: 25,
    });
    expect(text).toBe("6 added · 3 skipped · 1 failed");
  });
});

describe("summariseRun — enrich-business-email", () => {
  it("summarises a run that verified some and flagged others", () => {
    const { text } = summariseRun("enrich-business-email", {
      considered: 15, verified: 3, needs_review: 2, no_url: 4, no_email: 5, fetch_failed: 1, failed: 0,
    });
    expect(text).toBe("3 verified · 2 needs review · 4 no website found · 5 site had no email · 1 failed");
  });

  it("keeps no_url and no_email as separate, distinctly-worded counts", () => {
    // Folded into one "9 no email found" line (the pre-2026-08-20 behaviour),
    // an admin reading it would assume 9 real sites were checked and had no
    // contact address — when the real 2026-08-20 numbers (24 of 90 runs
    // no_url vs. 4 no_email) show most of that bucket is Perplexity finding no
    // candidate site at all, a different and more useful signal.
    const { text } = summariseRun("enrich-business-email", {
      considered: 6, verified: 0, needs_review: 0, no_url: 4, no_email: 0, fetch_failed: 0, failed: 0,
    });
    expect(text).toBe("0 verified · 4 no website found");
    expect(text).not.toContain("no email found");
  });

  it("omits either count when it is zero, rather than printing '0 no website found'", () => {
    const text = summariseRun("enrich-business-email", {
      considered: 3, verified: 0, needs_review: 0, no_url: 0, no_email: 3, fetch_failed: 0, failed: 0,
    }).text;
    expect(text).toBe("0 verified · 3 site had no email");
    expect(text).not.toContain("no website found");
  });

  it("distinguishes an empty candidate pool from a run that did work", () => {
    expect(
      summariseRun("enrich-business-email", {
        considered: 0, verified: 0, needs_review: 0, no_url: 0, no_email: 0, fetch_failed: 0, failed: 0,
      }),
    ).toEqual({ text: "nothing pending", noChange: true });
  });

  it("reports being switched off, distinct from an empty pool", () => {
    expect(summariseRun("enrich-business-email", { skipped: "disabled" }))
      .toEqual({ text: "enrichment off — nothing processed", noChange: true });
  });

  it("flags noChange only when nothing was verified or flagged for review", () => {
    const result = summariseRun("enrich-business-email", {
      considered: 5, verified: 0, needs_review: 0, no_url: 2, no_email: 3, fetch_failed: 0, failed: 0,
    });
    expect(result.noChange).toBe(true);

    const withVerified = summariseRun("enrich-business-email", {
      considered: 5, verified: 1, needs_review: 0, no_url: 2, no_email: 2, fetch_failed: 0, failed: 0,
    });
    expect(withVerified.noChange).toBe(false);
  });
});

describe("summariseRun — fallbacks", () => {
  it("returns no text for a run that logged no metadata", () => {
    expect(summariseRun("import-ingest-queue", {})).toEqual({ text: null, noChange: false });
    expect(summariseRun("anything", null)).toEqual({ text: null, noChange: false });
  });

  it("renders numeric counts for jobs without a bespoke formatter", () => {
    expect(summariseRun("send-nurture-emails", { sent: 4, failed: 0 }))
      .toEqual({ text: "sent: 4 · failed: 0", noChange: false });
  });

  it("flags an all-zero generic run as no-change", () => {
    expect(summariseRun("send-nurture-emails", { sent: 0, failed: 0 }).noChange).toBe(true);
  });

  it("ignores non-numeric metadata in the generic case", () => {
    expect(summariseRun("some-job", { note: "hello" })).toEqual({ text: null, noChange: false });
  });
});

describe("topRejectionReason", () => {
  it("returns the reason that accounts for the most rows", () => {
    expect(topRejectionReason({ rejected: { "city not configured": 2, "unusable phone": 9 } }))
      .toBe("unusable phone");
  });

  it("returns null when nothing was rejected", () => {
    expect(topRejectionReason({ rejected: {} })).toBeNull();
    expect(topRejectionReason({})).toBeNull();
    expect(topRejectionReason(null)).toBeNull();
  });
});
