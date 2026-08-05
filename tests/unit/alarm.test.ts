import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { raiseAlarm } from "../../supabase/functions/_shared/alarm";

/**
 * An alarm that fails to record is worse than useless — it implies the
 * condition didn't happen. These check the row shape a push integration will
 * watch for, and that raising one can never take down the request that was
 * trying to report a problem.
 */
function fakeClient(behaviour: { error?: { message: string }; throws?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("job_run_logs");
      return {
        insert(row: Record<string, unknown>) {
          if (behaviour.throws) throw new Error("connection lost");
          rows.push(row);
          return Promise.resolve({ error: behaviour.error ?? null });
        },
      };
    },
  };
  return { client: client as never, rows };
}

describe("raiseAlarm", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes under a distinct job_name so alarms are separable from job runs", async () => {
    // This is the exact predicate a push integration watches for.
    const { client, rows } = fakeClient();
    await raiseAlarm(client, "email_circuit_breaker", "breaker tripped");

    expect(rows).toHaveLength(1);
    expect(rows[0].job_name).toBe("alarm");
    expect(rows[0].status).toBe("failure");
  });

  it("carries the kind in metadata so alarms can be routed by type", async () => {
    const { client, rows } = fakeClient();
    await raiseAlarm(client, "suppression_spike", "40 suppressions in 24h", {
      suppressions_in_window: 40,
    });

    const meta = rows[0].metadata as Record<string, unknown>;
    expect(meta.alarm_kind).toBe("suppression_spike");
    expect(meta.suppressions_in_window).toBe(40);
  });

  it("puts the human-readable summary where it is visible without opening metadata", async () => {
    const { client, rows } = fakeClient();
    await raiseAlarm(client, "action_write_failed", "unsubscribe was NOT applied");
    expect(rows[0].error_message).toBe("unsubscribe was NOT applied");
  });

  it("never throws when the alarm write itself fails", async () => {
    // Raising an alarm must not take down the caller that detected the problem.
    const { client } = fakeClient({ error: { message: "permission denied" } });
    await expect(raiseAlarm(client, "email_circuit_breaker", "x")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws when the client blows up entirely", async () => {
    const { client } = fakeClient({ throws: true });
    await expect(raiseAlarm(client, "email_circuit_breaker", "x")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("still surfaces the condition to the console when the DB write fails", async () => {
    // The database is the primary record; the console is the last resort when
    // even that is unavailable.
    const { client } = fakeClient({ error: { message: "permission denied" } });
    await raiseAlarm(client, "suppression_spike", "40 suppressions in 24h");

    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .join(" ");
    expect(logged).toMatch(/suppression_spike/);
    expect(logged).toMatch(/40 suppressions/);
  });
});
