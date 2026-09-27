import { describe, it, expect } from "vitest";
import { jsonObject } from "../../src/integrations/supabase/json";

/**
 * The point of this helper is that it checks rather than asserts. The old
 * `as Record<string, unknown>` spelling accepted anything and produced an
 * object whose every property read `undefined` — so a jsonb column holding a
 * scalar looked like an object with no fields, indistinguishable from a real
 * empty one, and a null one threw on the first Object.entries.
 */
describe("jsonObject", () => {
  it("passes a JSON object through unchanged", () => {
    const value = { alarm_kind: "email_circuit_breaker", count: 260 };
    expect(jsonObject(value)).toEqual(value);
  });

  it("keeps an empty object, which is a real value and not an absence", () => {
    // job_run_logs.metadata is NOT NULL DEFAULT '{}', so this is the common case.
    expect(jsonObject({})).toEqual({});
  });

  it("rejects an array, which is an object to typeof but not a record", () => {
    expect(jsonObject(["a", "b"])).toBeNull();
  });

  it("rejects scalars", () => {
    expect(jsonObject("a string")).toBeNull();
    expect(jsonObject(42)).toBeNull();
    expect(jsonObject(true)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(jsonObject(null)).toBeNull();
    expect(jsonObject(undefined)).toBeNull();
  });

  it("does not clone, so callers read the value they were given", () => {
    const value = { nested: { deep: true } };
    expect(jsonObject(value)).toBe(value);
  });
});
