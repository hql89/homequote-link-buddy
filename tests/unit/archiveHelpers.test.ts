import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The admin UI must never issue a hard delete. These assert the helpers call
 * the archive RPCs with the right arguments — the destructive path
 * (admin_purge_archived) is deliberately not exposed to the frontend at all,
 * so there is nothing here that can destroy a row.
 */
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const nextError: { value: { message: string } | null } = { value: null };

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: null, error: nextError.value });
    },
  },
}));

const { archiveRow, restoreRow } = await import("../../src/lib/archive");

describe("archiveRow", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
  });

  it("calls the archive RPC rather than deleting", async () => {
    await archiveRow("businesses", "abc-123");
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("admin_archive_row");
    expect(calls[0].args).toEqual({
      p_table: "businesses",
      p_id: "abc-123",
      p_reason: null,
    });
  });

  it("passes a reason through so the audit entry explains itself", async () => {
    await archiveRow("buyer_profiles", "app-9", "application rejected");
    expect(calls[0].args.p_reason).toBe("application rejected");
  });

  it("normalises a missing reason to null rather than undefined", async () => {
    // undefined would be dropped from the JSON body, and the RPC's p_reason
    // has no default — PostgREST would reject the call.
    await archiveRow("reviews", "r-1");
    expect(calls[0].args.p_reason).toBeNull();
  });

  it("surfaces the error instead of swallowing it", async () => {
    nextError.value = { message: "permission denied for table businesses" };
    const { error } = await archiveRow("businesses", "abc-123");
    expect(error?.message).toBe("permission denied for table businesses");
  });
});

describe("restoreRow", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
  });

  it("calls the restore RPC with just the table and id", async () => {
    await restoreRow("posts", "post-7");
    expect(calls[0].fn).toBe("admin_restore_row");
    expect(calls[0].args).toEqual({ p_table: "posts", p_id: "post-7" });
  });

  it("surfaces errors", async () => {
    nextError.value = { message: "Forbidden" };
    const { error } = await restoreRow("posts", "post-7");
    expect(error?.message).toBe("Forbidden");
  });
});
