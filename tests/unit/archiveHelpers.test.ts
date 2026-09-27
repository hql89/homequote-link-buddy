import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The admin UI must never issue a hard delete. These assert the helpers call
 * the archive RPCs with the right arguments — the destructive path
 * (admin_purge_archived) is deliberately not exposed to the frontend at all,
 * so there is nothing here that can destroy a row.
 */
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const nextError: { value: { message: string } | null } = { value: null };
const nextData: { value: unknown } = { value: null };

vi.mock("../../src/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: nextData.value, error: nextError.value });
    },
  },
}));

const { archiveRow, restoreRow, fetchArchivedSummary, fetchArchivedRows } = await import(
  "../../src/lib/archive"
);

describe("archiveRow", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
    nextData.value = null;
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
    // undefined would be dropped from the JSON body entirely. p_reason does
    // have a DEFAULT NULL to fall through to, so that would probably work —
    // but "probably" is not what an audited path should rest on, and the
    // generated argument type renders the default as `p_reason?: string`,
    // which hides that null is accepted. Sent explicitly instead.
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
    nextData.value = null;
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

/**
 * The read helpers translate the RPC's own row shape into the one the Archive
 * screen consumes. These lock in the three places where the generated type and
 * the database disagree — the generator cannot mark a `RETURNS TABLE` column
 * nullable, cannot say a `jsonb` output is an object, and types a bigint
 * `count(*)` as a number it may not arrive as.
 */
describe("fetchArchivedSummary", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
    nextData.value = null;
  });

  it("asks the summary RPC for nothing but itself", async () => {
    await fetchArchivedSummary();
    expect(calls[0].fn).toBe("admin_archived_summary");
  });

  it("coerces a bigint count that arrived as a string", async () => {
    // count(*) is bigint. Whether it survives JSON as a number is not
    // something the frontend should depend on: the Archive screen sums these
    // and compares them to 0, and "2" + "1" would read as 21 archived items.
    nextData.value = [{ table_name: "businesses", archived_count: "2" }];
    const { data } = await fetchArchivedSummary();
    expect(data[0].archived_count).toBe(2);
    expect(typeof data[0].archived_count).toBe("number");
  });

  it("returns an empty list rather than null when there is no data", async () => {
    nextData.value = null;
    const { data } = await fetchArchivedSummary();
    expect(data).toEqual([]);
  });
});

describe("fetchArchivedRows", () => {
  beforeEach(() => {
    calls.length = 0;
    nextError.value = null;
    nextData.value = null;
  });

  it("passes the table, limit and offset through", async () => {
    await fetchArchivedRows("posts", 25, 50);
    expect(calls[0].fn).toBe("admin_list_archived");
    expect(calls[0].args).toEqual({ p_table: "posts", p_limit: 25, p_offset: 50 });
  });

  it("keeps a null archived_by and reason null instead of inventing a value", async () => {
    // Genuinely null on anything archived by the service role, or archived
    // without a reason — the generated row type says neither can happen.
    nextData.value = [
      {
        id: "b-1",
        label: "Griffin's Plumbing",
        archived_at: "2026-08-01T00:00:00Z",
        archived_by: null,
        archive_reason: null,
        row_data: { business_name: "Griffin's Plumbing" },
      },
    ];
    const { data } = await fetchArchivedRows("businesses");
    expect(data[0].archived_by).toBeNull();
    expect(data[0].archive_reason).toBeNull();
    expect(data[0].row_data).toEqual({ business_name: "Griffin's Plumbing" });
  });

  it("falls back to an empty object when row_data is not an object", async () => {
    // to_jsonb(row) always yields an object, so this should never happen — but
    // the Archive screen calls Object.entries on row_data, which throws on
    // null. An empty object renders its "No further detail recorded" state
    // instead of taking the page down.
    for (const rowData of [null, "a string", 42, ["an", "array"]]) {
      nextData.value = [
        {
          id: "b-1",
          label: "b-1",
          archived_at: "2026-08-01T00:00:00Z",
          archived_by: null,
          archive_reason: null,
          row_data: rowData,
        },
      ];
      const { data } = await fetchArchivedRows("businesses");
      expect(data[0].row_data).toEqual({});
      expect(() => Object.entries(data[0].row_data)).not.toThrow();
    }
  });

  it("returns an empty list rather than null when there is no data", async () => {
    const { data, error } = await fetchArchivedRows("businesses");
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });
});
