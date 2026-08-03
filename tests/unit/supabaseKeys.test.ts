import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  serviceRoleKey,
  publishableKey,
  SupabaseKeyError,
} from "../../supabase/functions/_shared/supabaseKeys";

/**
 * This module deliberately has no fallback to the legacy keys, so its failure
 * behaviour IS the feature: a half-migrated function must break loudly before
 * cutover rather than quietly keep working until the legacy keys are switched
 * off. Most of what follows tests that it fails, and that the message says
 * which variable is at fault.
 *
 * `Deno` does not exist under vitest, so it is stubbed on globalThis — the
 * module only ever touches Deno.env.get.
 */
const originalDeno = (globalThis as Record<string, unknown>).Deno;

function setEnv(vars: Record<string, string | undefined>) {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (name: string) => vars[name] },
  };
}

describe("serviceRoleKey", () => {
  beforeEach(() => setEnv({}));
  afterEach(() => {
    (globalThis as Record<string, unknown>).Deno = originalDeno;
    vi.restoreAllMocks();
  });

  it("reads the default key out of the JSON object", () => {
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_abc123" }) });
    expect(serviceRoleKey()).toBe("sb_secret_abc123");
  });

  it("can read a non-default key by name", () => {
    setEnv({
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_a", worker: "sb_secret_b" }),
    });
    expect(serviceRoleKey("worker")).toBe("sb_secret_b");
  });

  it("throws a named error when the variable is missing", () => {
    // The migration's core bet: this is loud, not silent.
    expect(() => serviceRoleKey()).toThrow(SupabaseKeyError);
    expect(() => serviceRoleKey()).toThrow(/SUPABASE_SECRET_KEYS is not set/);
  });

  it("never falls back to the legacy service_role key", () => {
    // A fallback would mask an incomplete migration until the legacy keys are
    // disabled, at which point everything fails at once with no attribution.
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt-value" });
    expect(() => serviceRoleKey()).toThrow(SupabaseKeyError);
  });

  it("throws when the value is not valid JSON", () => {
    setEnv({ SUPABASE_SECRET_KEYS: "sb_secret_plain_string_not_json" });
    expect(() => serviceRoleKey()).toThrow(/not valid JSON/);
  });

  it("does not leak the credential into the error message", () => {
    setEnv({ SUPABASE_SECRET_KEYS: "sb_secret_SUPERSECRET_VALUE" });
    try {
      serviceRoleKey();
      throw new Error("expected it to throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("SUPERSECRET");
    }
  });

  it("throws when the JSON is an array rather than an object", () => {
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify(["sb_secret_abc"]) });
    expect(() => serviceRoleKey()).toThrow(/expected an object/);
  });

  it("names the keys that ARE available when the requested one is absent", () => {
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ staging: "sb_secret_x" }) });
    expect(() => serviceRoleKey()).toThrow(/no usable key named "default"/);
    expect(() => serviceRoleKey()).toThrow(/staging/);
  });

  it("rejects an empty or blank key value rather than passing it on", () => {
    // An empty string would reach createClient and fail far from the cause.
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "" }) });
    expect(() => serviceRoleKey()).toThrow(SupabaseKeyError);

    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "   " }) });
    expect(() => serviceRoleKey()).toThrow(SupabaseKeyError);
  });
});

describe("publishableKey", () => {
  beforeEach(() => setEnv({}));
  afterEach(() => {
    (globalThis as Record<string, unknown>).Deno = originalDeno;
  });

  it("reads the default key out of its own variable", () => {
    setEnv({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_xyz" }) });
    expect(publishableKey()).toBe("sb_publishable_xyz");
  });

  it("names PUBLISHABLE, not SECRET, when it is the one missing", () => {
    // The two key sets fail identically at the call site; the message is the
    // only thing that says which is misconfigured.
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_abc" }) });
    expect(() => publishableKey()).toThrow(/SUPABASE_PUBLISHABLE_KEYS is not set/);
  });

  it("does not read the secret keys variable by mistake", () => {
    setEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_PRIVILEGED" }) });
    expect(() => publishableKey()).toThrow(SupabaseKeyError);
  });
});
