import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSmtpPassword, type RpcCaller } from "../../supabase/functions/_shared/smtpSecret";

/**
 * The property that matters: the password comes from Vault, and the legacy
 * plaintext path is only ever a migration-window safety net that announces
 * itself. Nothing here may ever log the password itself.
 */

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: string[] = [];
  const client: RpcCaller = {
    rpc: (fn: string) => {
      calls.push(fn);
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

describe("loadSmtpPassword", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("reads the password from Vault via get_smtp_password", async () => {
    const { client, calls } = fakeClient({ data: "vault-secret", error: null });

    const result = await loadSmtpPassword(client);

    expect(calls).toEqual(["get_smtp_password"]);
    expect(result.password).toBe("vault-secret");
    expect(result.error).toBeNull();
    expect(result.legacy).toBe(false);
  });

  it("prefers Vault over a legacy plaintext value that is still present", async () => {
    const { client } = fakeClient({ data: "vault-secret", error: null });

    const result = await loadSmtpPassword(client, "stale-plaintext");

    expect(result.password).toBe("vault-secret");
    expect(result.legacy).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to the legacy plaintext when Vault has no secret, and says so", async () => {
    const { client } = fakeClient({ data: null, error: null });

    const result = await loadSmtpPassword(client, "old-plaintext");

    expect(result.password).toBe("old-plaintext");
    expect(result.error).toBeNull();
    expect(result.legacy).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    // The warning must explain the situation without ever containing the value.
    const warned = String(warn.mock.calls[0][0]);
    expect(warned).toMatch(/legacy plaintext/i);
    expect(warned).not.toContain("old-plaintext");
  });

  it("falls back when the Vault read itself errors", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });

    const result = await loadSmtpPassword(client, "old-plaintext");

    expect(result.password).toBe("old-plaintext");
    expect(result.legacy).toBe(true);
    expect(String(warn.mock.calls[0][0])).toContain("permission denied");
  });

  it("reports an honest error when Vault fails and there is no fallback", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied" } });

    const result = await loadSmtpPassword(client);

    expect(result.password).toBeNull();
    // Names the real cause rather than sending the reader to the Settings page
    // for a problem that is not there.
    expect(result.error).toMatch(/Vault/i);
    expect(result.error).toContain("permission denied");
  });

  it("reports 'no password stored' — not a Vault failure — when the secret is simply absent", async () => {
    const { client } = fakeClient({ data: null, error: null });

    const result = await loadSmtpPassword(client);

    expect(result.password).toBeNull();
    expect(result.error).toMatch(/No SMTP password is stored/i);
  });

  it("treats a blank or whitespace secret as absent", async () => {
    const { client } = fakeClient({ data: "   ", error: null });

    const result = await loadSmtpPassword(client, "  ");

    expect(result.password).toBeNull();
    expect(result.error).toMatch(/No SMTP password is stored/i);
  });
});
