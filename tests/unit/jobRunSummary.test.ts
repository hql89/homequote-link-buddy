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
