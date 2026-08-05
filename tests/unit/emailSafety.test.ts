import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isSelfAddressed, checkVolumeCircuitBreaker } from "../../supabase/functions/_shared/emailSafety";

/**
 * Both guards here were ported after a real incident in a sibling project
 * (Mivos.ai, 2026-08): a notification mailed to its own sending address was
 * re-ingested by an inbound poller watching that mailbox as a new lead,
 * which produced another notification — indefinitely, ~1,000+ times.
 */

describe("isSelfAddressed", () => {
  const identity = { fromEmail: "admin@homequotelink.com", smtpUsername: "admin@homequotelink.com" };

  it("catches the exact shape of the Mivos incident: recipient equals the sending address", () => {
    expect(isSelfAddressed("admin@homequotelink.com", identity)).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isSelfAddressed("Admin@HomeQuoteLink.com", identity)).toBe(true);
    expect(isSelfAddressed("  admin@homequotelink.com  ", identity)).toBe(true);
  });

  it("matches against smtpUsername even when it differs from fromEmail", () => {
    const split = { fromEmail: "outreach@homequotelink.com", smtpUsername: "smtp-login@homequotelink.com" };
    expect(isSelfAddressed("smtp-login@homequotelink.com", split)).toBe(true);
    expect(isSelfAddressed("outreach@homequotelink.com", split)).toBe(true);
  });

  it("does not flag a real, distinct recipient", () => {
    expect(isSelfAddressed("owner@luxairhvac.com", identity)).toBe(false);
    expect(isSelfAddressed("dgarcia89@gmail.com", identity)).toBe(false);
  });

  it("does not flag an empty recipient as self-addressed", () => {
    // Empty `to` is a different bug (caught elsewhere); this function's job
    // is specifically the self-addressing check, not general validation.
    expect(isSelfAddressed("", identity)).toBe(false);
    expect(isSelfAddressed("   ", identity)).toBe(false);
  });
});

describe("checkVolumeCircuitBreaker", () => {
  const OLD_ENV = { ...process.env };

  function fakeClient(opts: {
    sendCount?: number;
    countError?: { message: string };
    existingSmtpConfig?: Record<string, unknown>;
    updateError?: { message: string };
  }) {
    const updateCalls: Record<string, unknown>[] = [];
    const client = {
      from(table: string) {
        if (table === "email_send_log") {
          return {
            select: () => ({
              gte: () =>
                Promise.resolve({
                  count: opts.countError ? null : (opts.sendCount ?? 0),
                  error: opts.countError ?? null,
                }),
            }),
          };
        }
        if (table === "admin_settings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { setting_value: opts.existingSmtpConfig ?? { smtpHost: "sv20.byethost20.org", enabled: true } },
                  }),
              }),
            }),
            update: (values: Record<string, unknown>) => {
              updateCalls.push(values);
              return { eq: () => Promise.resolve({ error: opts.updateError ?? null }) };
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };
    return { client: client as never, updateCalls };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...OLD_ENV };
  });

  it("does not trip under the threshold", async () => {
    const { client } = fakeClient({ sendCount: 249 });
    const result = await checkVolumeCircuitBreaker(client);
    expect(result.tripped).toBe(false);
  });

  it("trips at the threshold, not only strictly above it", async () => {
    const { client } = fakeClient({ sendCount: 250 });
    const result = await checkVolumeCircuitBreaker(client);
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/250/);
  });

  it("well past the threshold — approaching the actual Mivos incident scale — still just trips once", async () => {
    const { client } = fakeClient({ sendCount: 1100 });
    const result = await checkVolumeCircuitBreaker(client);
    expect(result.tripped).toBe(true);
  });

  it("FAILS CLOSED when the count query itself errors, rather than assuming zero", async () => {
    // The exact weakness flagged in Mivos's own breaker: it counted off a
    // log table whose writer swallows its own errors, so a failed write
    // silently undercounted. This must refuse rather than risk that.
    const { client } = fakeClient({ countError: { message: "connection reset" } });
    const result = await checkVolumeCircuitBreaker(client);
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/could not verify/i);
  });

  it("merges into the existing smtp_config rather than replacing it", async () => {
    // A real bug caught during review: writing {enabled: false} directly
    // would have silently destroyed smtpHost/Password/fromEmail/etc.
    const { client, updateCalls } = fakeClient({
      sendCount: 300,
      existingSmtpConfig: {
        smtpHost: "sv20.byethost20.org",
        smtpPort: 465,
        smtpUsername: "admin@homequotelink.com",
        smtpPassword: "correct-horse-battery-staple",
        fromEmail: "admin@homequotelink.com",
        fromName: "Home Quote Link",
        adminNotificationEmail: "dgarcia89@gmail.com",
        enabled: true,
      },
    });

    await checkVolumeCircuitBreaker(client);

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].setting_value as Record<string, unknown>;
    expect(written.enabled).toBe(false);
    // Every other field must survive the write untouched.
    expect(written.smtpHost).toBe("sv20.byethost20.org");
    expect(written.smtpPassword).toBe("correct-horse-battery-staple");
    expect(written.fromEmail).toBe("admin@homequotelink.com");
    expect(written.adminNotificationEmail).toBe("dgarcia89@gmail.com");
  });

  it("does not throw when the disable write itself fails", async () => {
    // Best-effort: the send is refused via the tripped result regardless of
    // whether the kill switch could be written.
    const { client } = fakeClient({ sendCount: 300, updateError: { message: "permission denied" } });
    await expect(checkVolumeCircuitBreaker(client)).resolves.toMatchObject({ tripped: true });
  });
});
