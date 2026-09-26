import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { raiseAlarm } from "../../supabase/functions/_shared/alarm";

/**
 * An alarm that fails to record is worse than useless — it implies the
 * condition didn't happen. These check the row shape a push integration will
 * watch for, and that raising one can never take down the request that was
 * trying to report a problem.
 */
function fakeClient(
  behaviour: {
    error?: { message: string };
    throws?: boolean;
    /** Alarms of this kind already inside the email cooldown window. The row
     *  raiseAlarm itself just wrote counts, so 1 means "only this one". */
    recentSameKind?: number;
  } = {},
) {
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
        // The cooldown read in emailAlarm.
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => Promise.resolve({ count: behaviour.recentSameKind ?? 1, error: null }),
            }),
          }),
        }),
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


/**
 * The push half. Recording an alarm was never the problem — being told about
 * it was. enrich-business-email failed 30 mornings in a row with the reason
 * sitting in the database the whole time.
 */
describe("raiseAlarm — emailing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", fetchMock);
    // Deno does not exist under vitest; without this the env read throws and
    // the email path silently no-ops, which would make these tests vacuous.
    vi.stubGlobal("Deno", { env: { get: () => "https://test.supabase.co" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emails the admin the first time a kind fires", async () => {
    const { client } = fakeClient({ recentSameKind: 1 });
    await raiseAlarm(client, "job_failing_repeatedly", "enrichment has failed 30 runs in a row");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/functions/v1/notify-admin-email");
    const body = JSON.parse(String(init.body));
    expect(body.notificationType).toBe("alarm");
    expect(body.alarmData.kind).toBe("job_failing_repeatedly");
    expect(body.alarmData.summary).toContain("30 runs in a row");
  });

  it("goes quiet when the same kind already fired recently", async () => {
    // The delivery canary re-fired hourly for a week in August. An inbox that
    // gets that becomes the thing that is ignored.
    const { client } = fakeClient({ recentSameKind: 4 });
    await raiseAlarm(client, "delivery_canary_failed", "probe unconfirmed");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still records the alarm when the email cannot be sent", async () => {
    fetchMock.mockRejectedValue(new Error("mail host unreachable"));
    const { client, rows } = fakeClient({ recentSameKind: 1 });

    await expect(
      raiseAlarm(client, "email_circuit_breaker", "sending disabled"),
    ).resolves.toBeUndefined();

    // The database record is the durable part and must not depend on the push.
    expect(rows).toHaveLength(1);
    expect(rows[0].error_message).toBe("sending disabled");
  });

  it("does not email when the alarm could not be recorded", async () => {
    // A push implying a record that does not exist sends someone looking for
    // something they will not find.
    const { client } = fakeClient({ error: { message: "insert failed" } });
    await raiseAlarm(client, "action_write_failed", "write failed");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
