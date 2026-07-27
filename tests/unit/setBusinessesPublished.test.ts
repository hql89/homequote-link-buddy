import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bulk publish is the one admin action that makes listings public, and it runs
 * over hundreds of rows in chunks. The behaviour that matters is what it
 * reports when a chunk fails partway: the caller uses `updated` to decide which
 * rows to drop from the review table, so an over-count silently hides listings
 * that were never actually published.
 */
const calls: { values: Record<string, unknown>; ids: string[] }[] = [];
const failOnCall = { index: -1 };

// directoryDb is a typed cast of the client from ./client, so that is the
// module the mock has to replace.
vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        in: (_col: string, ids: string[]) => {
          calls.push({ values, ids });
          return Promise.resolve(
            calls.length - 1 === failOnCall.index
              ? { error: { message: "permission denied" } }
              : { error: null },
          );
        },
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  },
}));

const { setBusinessesPublished } = await import("../../src/integrations/supabase/directory");

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("setBusinessesPublished", () => {
  beforeEach(() => {
    calls.length = 0;
    failOnCall.index = -1;
  });

  it("publishes a small selection in one statement", async () => {
    const result = await setBusinessesPublished(ids(3), true);
    expect(result).toEqual({ updated: 3, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual({ is_published: true });
  });

  it("chunks a large selection rather than sending one enormous query string", async () => {
    const result = await setBusinessesPublished(ids(536), true);
    expect(result.updated).toBe(536);
    expect(calls).toHaveLength(6); // 100 × 5 + 36
    expect(calls.at(-1)!.ids).toHaveLength(36);
  });

  it("reports how far it got when a chunk fails, not the whole selection", async () => {
    failOnCall.index = 2; // third chunk
    const { updated, error } = await setBusinessesPublished(ids(536), true);
    expect(updated).toBe(200);
    expect(error?.message).toBe("permission denied");
  });

  it("stops after a failure instead of pressing on", async () => {
    failOnCall.index = 0;
    await setBusinessesPublished(ids(536), true);
    expect(calls).toHaveLength(1);
  });

  it("can unpublish as well as publish", async () => {
    await setBusinessesPublished(ids(2), false);
    expect(calls[0].values).toEqual({ is_published: false });
  });

  it("does nothing for an empty selection", async () => {
    const result = await setBusinessesPublished([], true);
    expect(result).toEqual({ updated: 0, error: null });
    expect(calls).toHaveLength(0);
  });
});
