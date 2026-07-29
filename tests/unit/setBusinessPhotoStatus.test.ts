import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * business_photos is a hand-declared table (see directory.ts), so its Update
 * generic resolves to `never` in supabase-js without the WritableTable cast.
 * The property worth testing is that the cast doesn't silently change what
 * gets sent — the moderation action must write exactly { status }, nothing
 * else, and must target the row by id.
 */
const calls: { values: Record<string, unknown>; id: string }[] = [];
let nextError: { message: string } | null = null;

// directoryDb is a typed cast of the client from ./client, so that is the
// module the mock has to replace.
vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          calls.push({ values, id });
          return Promise.resolve({ error: nextError });
        },
      }),
    }),
  },
}));

const { setBusinessPhotoStatus } = await import("../../src/integrations/supabase/directory");

describe("setBusinessPhotoStatus", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError = null;
  });

  it("approves a photo by writing only its status", async () => {
    const error = await setBusinessPhotoStatus("photo-1", "approved");
    expect(error).toBeNull();
    expect(calls).toEqual([{ values: { status: "approved" }, id: "photo-1" }]);
  });

  it("rejects a photo the same way", async () => {
    await setBusinessPhotoStatus("photo-2", "rejected");
    expect(calls[0].values).toEqual({ status: "rejected" });
  });

  it("surfaces the error instead of swallowing it", async () => {
    nextError = { message: "permission denied" };
    const error = await setBusinessPhotoStatus("photo-3", "approved");
    expect(error?.message).toBe("permission denied");
  });
});
