import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toDisplayAlarm, unseenAlarms, type AlarmKind, type AlarmRecord } from "../../src/lib/alarmDisplay";

/**
 * This is the translation between what raiseAlarm() writes for a machine to
 * find later and what a person reads on the banner. The property that
 * matters most: a future AlarmKind this build doesn't know about must still
 * become a visible, honest alarm — never silently dropped, never rendered as
 * a raw slug.
 */

function record(over: Partial<AlarmRecord> = {}): AlarmRecord {
  return {
    id: "alarm-1",
    errorMessage: "Circuit breaker tripped: 260 emails in 10 minutes.",
    metadata: { alarm_kind: "email_circuit_breaker" },
    createdAt: "2026-08-20T12:00:00Z",
    ...over,
  };
}

describe("toDisplayAlarm", () => {
  it("renders a known kind as plain language, never the raw slug", () => {
    const d = toDisplayAlarm(record());
    expect(d.title).not.toContain("email_circuit_breaker");
    expect(d.title).toBe("Outbound email was automatically disabled");
    expect(d.severity).toBe("critical");
  });

  it("covers every kind currently defined in the edge function", () => {
    // Pinned against the source rather than hand-copied, so an added AlarmKind
    // in alarm.ts that nobody updated the display map for fails a test instead
    // of silently rendering as an unrecognised alarm in production.
    const source = readFileSync("supabase/functions/_shared/alarm.ts", "utf8");
    const start = source.indexOf("export type AlarmKind");
    // Ends at the blank line after the union, not the first ";" — a doc
    // comment inside the union ("...disabled project-wide.") contains one
    // and would truncate the block before any member is read.
    const block = source.slice(start, source.indexOf("\n\n", start));
    const kinds = [...block.matchAll(/^\s*\|\s*"([a-z_]+)"/gm)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThan(0);

    for (const kind of kinds) {
      const d = toDisplayAlarm(record({ metadata: { alarm_kind: kind } }));
      expect(d.title).not.toBe(kind);
      expect(d.title.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the recorded message for an unrecognised kind, rather than dropping it", () => {
    const d = toDisplayAlarm(
      record({ metadata: { alarm_kind: "some_future_kind" }, errorMessage: "Something new broke." }),
    );
    expect(d.title).toBe("Something new broke.");
  });

  it("defaults an unrecognised kind to critical, never a quiet warning", () => {
    // A false alarm read as urgent costs a glance. A genuinely serious future
    // kind silently read as a warning defeats the point of the field existing.
    const d = toDisplayAlarm(record({ metadata: { alarm_kind: "unknown_future_kind" } }));
    expect(d.severity).toBe("critical");
  });

  it("handles missing or malformed metadata without throwing", () => {
    expect(() => toDisplayAlarm(record({ metadata: null }))).not.toThrow();
    expect(() => toDisplayAlarm(record({ metadata: {} }))).not.toThrow();
    expect(() => toDisplayAlarm(record({ metadata: { alarm_kind: 42 as unknown as string } }))).not.toThrow();
  });

  it("still shows something even with no error message and no known kind", () => {
    const d = toDisplayAlarm(record({ metadata: null, errorMessage: null }));
    expect(d.title.length).toBeGreaterThan(0);
  });
});

describe("unseenAlarms", () => {
  const alarms = [
    toDisplayAlarm(record({ id: "a", createdAt: "2026-08-18T00:00:00Z" })),
    toDisplayAlarm(record({ id: "b", createdAt: "2026-08-20T00:00:00Z" })),
    toDisplayAlarm(record({ id: "c", createdAt: "2026-08-19T00:00:00Z" })),
  ];

  it("treats a null cutoff as everything unseen", () => {
    expect(unseenAlarms(alarms, null).map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("excludes anything at or before the cutoff", () => {
    const result = unseenAlarms(alarms, "2026-08-19T00:00:00Z");
    expect(result.map((a) => a.id)).toEqual(["b"]);
  });

  it("sorts newest first regardless of input order", () => {
    expect(unseenAlarms(alarms, null)[0].id).toBe("b");
  });

  it("returns nothing once the cutoff is past every alarm", () => {
    expect(unseenAlarms(alarms, "2026-08-21T00:00:00Z")).toEqual([]);
  });
});
