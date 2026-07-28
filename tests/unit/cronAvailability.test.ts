import { describe, it, expect } from "vitest";
import { classifyCronError, cronErrorMessage } from "../../src/lib/cronAvailability";

/**
 * The distinction under test: a database without pg_cron and an admin check
 * refusing the call both surface as a failed RPC, but they need different words
 * on screen. Getting this wrong tells an admin their permissions are broken when
 * the extension simply isn't installed.
 */
describe("classifyCronError", () => {
  it("reads SQLSTATE 42P01 as a missing pg_cron extension", () => {
    expect(
      classifyCronError({ code: "42P01", message: 'relation "cron.job" does not exist' }),
    ).toBe("unavailable");
  });

  it("reads a raised Forbidden as a permissions problem", () => {
    expect(classifyCronError({ code: "P0001", message: "Forbidden" })).toBe("forbidden");
  });

  it("falls back to the message when no code is present", () => {
    expect(
      classifyCronError({ message: 'relation "cron.job" does not exist' }),
    ).toBe("unavailable");
    expect(classifyCronError({ message: "Forbidden" })).toBe("forbidden");
  });

  it("does not treat an unrelated missing relation as a scheduling problem", () => {
    expect(
      classifyCronError({ code: "42P01", message: 'relation "public.widgets" does not exist' }),
    ).toBe("unavailable"); // code is authoritative
    expect(
      classifyCronError({ message: 'relation "public.widgets" does not exist' }),
    ).toBe("unknown"); // message alone must name cron.job
  });

  it("returns unknown rather than guessing", () => {
    expect(classifyCronError(null)).toBe("unknown");
    expect(classifyCronError(undefined)).toBe("unknown");
    expect(classifyCronError("boom")).toBe("unknown");
    expect(classifyCronError(new Error("network unreachable"))).toBe("unknown");
    expect(classifyCronError({ code: "08006", message: "connection failure" })).toBe("unknown");
  });

  it("classifies a P0001 that isn't Forbidden as unknown", () => {
    expect(classifyCronError({ code: "P0001", message: "Unknown job: nope" })).toBe("unknown");
  });
});

describe("cronErrorMessage", () => {
  it("prefers the error's own message", () => {
    expect(cronErrorMessage({ message: "connection failure" })).toBe("connection failure");
  });

  it("falls back when there is nothing usable to show", () => {
    expect(cronErrorMessage(null)).toBe("The scheduler could not be reached.");
    expect(cronErrorMessage({ message: "   " })).toBe("The scheduler could not be reached.");
    expect(cronErrorMessage({})).toBe("The scheduler could not be reached.");
  });
});
