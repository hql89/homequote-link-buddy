import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkTokenMissRate } from "../../supabase/functions/_shared/alarmRate";

/**
 * checkTokenMissRate debounces a caller-controlled-rate signal into at most
 * one alarm per cooldown window. These pin: the threshold itself, that a
 * live cooldown suppresses further alarms, that the cooldown check runs
 * (and short-circuits) before the count query, and that either query
 * failing degrades quietly rather than throwing.
 */
function fakeClient(
  opts: {
    cooldownCount?: number;
    cooldownError?: { message: string };
    missCount?: number;
    missError?: { message: string };
    insertError?: { message: string };
  } = {},
) {
  const inserted: Record<string, unknown>[] = [];
  const selectCalls: Array<Record<string, unknown>> = [];

  const client = {
    from(table: string) {
      expect(table).toBe("job_run_logs");
      return {
        select(_cols: string, _selectOpts?: unknown) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            gte(col: string, val: unknown) {
              filters[col] = val;
              return builder;
            },
            then(resolve: (v: { count: number | null; error: unknown }) => void) {
              selectCalls.push(filters);
              const isCooldownQuery = filters["metadata->>alarm_kind"] !== undefined;
              if (isCooldownQuery) {
                resolve({ count: opts.cooldownCount ?? 0, error: opts.cooldownError ?? null });
              } else {
                resolve({ count: opts.missCount ?? 0, error: opts.missError ?? null });
              }
            },
          };
          return builder;
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      };
    },
  };
  return { client: client as never, inserted, selectCalls };
}

describe("checkTokenMissRate", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("raises nothing below threshold", async () => {
    const { client, inserted } = fakeClient({ missCount: 9 });
    await checkTokenMissRate(client, "unsubscribe");
    expect(inserted).toHaveLength(0);
  });

  it("raises exactly one alarm once the threshold is met", async () => {
    const { client, inserted } = fakeClient({ missCount: 10 });
    await checkTokenMissRate(client, "unsubscribe");

    expect(inserted).toHaveLength(1);
    expect(inserted[0].job_name).toBe("alarm");
    const meta = inserted[0].metadata as Record<string, unknown>;
    expect(meta.alarm_kind).toBe("unsubscribe_token_misses");
    expect(meta.misses_in_window).toBe(10);
  });

  it("raises when the count is above threshold too", async () => {
    const { client, inserted } = fakeClient({ missCount: 47 });
    await checkTokenMissRate(client, "unsubscribe");
    expect(inserted).toHaveLength(1);
  });

  it("stays quiet when an alarm already fired within the cooldown window", async () => {
    const { client, inserted, selectCalls } = fakeClient({ cooldownCount: 1, missCount: 999 });
    await checkTokenMissRate(client, "unsubscribe");

    expect(inserted).toHaveLength(0);
    // The count query must never even run once the cooldown short-circuits.
    expect(selectCalls).toHaveLength(1);
  });

  it("checks the cooldown before counting misses", async () => {
    const { client, selectCalls } = fakeClient({ missCount: 10 });
    await checkTokenMissRate(client, "unsubscribe");

    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[0]["metadata->>alarm_kind"]).toBe("unsubscribe_token_misses");
    expect(selectCalls[1]["error_message"]).toBe("No business for token");
  });

  it("degrades quietly when the cooldown check itself fails", async () => {
    const { client, inserted } = fakeClient({ cooldownError: { message: "connection lost" } });
    await expect(checkTokenMissRate(client, "unsubscribe")).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("degrades quietly when the miss-count query fails", async () => {
    const { client, inserted } = fakeClient({ missError: { message: "timeout" } });
    await expect(checkTokenMissRate(client, "unsubscribe")).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
    expect(console.error).toHaveBeenCalled();
  });
});
