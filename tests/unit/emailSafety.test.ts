import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSelfAddressed,
  checkVolumeCircuitBreaker,
  resolveBccCopy,
  buildUnsubscribeHeaders,
  evaluateBounceCircuit,
  resolveBounceCircuitSettings,
  BOUNCE_CIRCUIT_DEFAULTS,
} from "../../supabase/functions/_shared/emailSafety";
import { classifyReply } from "../../supabase/functions/_shared/inboundClassifier";

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

describe("resolveBccCopy", () => {
  const identity = { fromEmail: "admin@homequotelink.com", smtpUsername: "admin@homequotelink.com" };

  it("allows a copy to a mailbox nothing polls", () => {
    expect(resolveBccCopy("dgarcia89@gmail.com", identity)).toEqual({ bcc: "dgarcia89@gmail.com" });
  });

  it("treats an empty or absent setting as off", () => {
    expect(resolveBccCopy("", identity).bcc).toBeNull();
    expect(resolveBccCopy(null, identity).bcc).toBeNull();
    expect(resolveBccCopy(undefined, identity).bcc).toBeNull();
  });

  it("blank-but-not-empty (whitespace) is off, not a send to nowhere", () => {
    expect(resolveBccCopy("   ", identity).bcc).toBeNull();
  });

  it("REFUSES a copy to the sending identity — the loop this guard exists for", () => {
    // BCC'ing the sending mailbox would feed every outreach email back through
    // the n8n IMAP bridge into receive-inbound-email, where the outreach copy's
    // own "reply YES" / STOP wording would be classified as a business reply.
    const decision = resolveBccCopy("admin@homequotelink.com", identity);
    expect(decision.bcc).toBeNull();
    expect(decision.refused).toMatch(/re-ingested as business replies/);
  });

  it("refuses the sending identity regardless of case or padding", () => {
    expect(resolveBccCopy("  Admin@HomeQuoteLink.com ", identity).bcc).toBeNull();
  });

  it("refuses the smtpUsername even when it differs from fromEmail", () => {
    const split = { fromEmail: "outreach@homequotelink.com", smtpUsername: "smtp-login@homequotelink.com" };
    expect(resolveBccCopy("smtp-login@homequotelink.com", split).bcc).toBeNull();
  });

  it("drops a malformed address rather than letting SMTP reject the whole message", () => {
    const decision = resolveBccCopy("not-an-email", identity);
    expect(decision.bcc).toBeNull();
    expect(decision.refused).toMatch(/not a valid email address/);
  });

  it("always explains a refusal, so copies never stop for an invisible reason", () => {
    for (const bad of ["admin@homequotelink.com", "nope", "a@b"]) {
      expect(resolveBccCopy(bad, identity).refused).toBeTruthy();
    }
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
    // would have silently destroyed smtpHost/Username/fromEmail/etc.
    //
    // The fixture carries no smtpPassword because the row no longer has one —
    // the password moved to Supabase Vault. This used to assert the password
    // survived the merge; that assertion was retired with the field rather
    // than kept pointing at something the row must never contain again.
    const { client, updateCalls } = fakeClient({
      sendCount: 300,
      existingSmtpConfig: {
        smtpHost: "sv20.byethost20.org",
        smtpPort: 465,
        smtpUsername: "admin@homequotelink.com",
        smtpPasswordHint: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022aple",
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
    expect(written.smtpUsername).toBe("admin@homequotelink.com");
    expect(written.smtpPasswordHint).toBe("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022aple");
    expect(written.fromEmail).toBe("admin@homequotelink.com");
    expect(written.adminNotificationEmail).toBe("dgarcia89@gmail.com");
    // The breaker must never resurrect a plaintext password into the row.
    expect(written).not.toHaveProperty("smtpPassword");
  });

  it("does not throw when the disable write itself fails", async () => {
    // Best-effort: the send is refused via the tripped result regardless of
    // whether the kill switch could be written.
    const { client } = fakeClient({ sendCount: 300, updateError: { message: "permission denied" } });
    await expect(checkVolumeCircuitBreaker(client)).resolves.toMatchObject({ tripped: true });
  });
});

// Added alongside the unsubscribe/index.ts edge function and the
// {{unsubscribe_url}} line in outreach copy (2026-08-20): outreach mail had
// no List-Unsubscribe header at all, so neither a mailbox provider's own
// "Unsubscribe" button nor RFC 8058 one-click worked, regardless of what the
// email body said.
describe("buildUnsubscribeHeaders", () => {
  it("wraps the URL in angle brackets per RFC 8058", () => {
    const headers = buildUnsubscribeHeaders("https://example.supabase.co/functions/v1/unsubscribe?token=abc");
    expect(headers["List-Unsubscribe"]).toBe(
      "<https://example.supabase.co/functions/v1/unsubscribe?token=abc>",
    );
  });

  it("declares one-click support so mail clients don't require opening a page", () => {
    const headers = buildUnsubscribeHeaders("https://example.supabase.co/functions/v1/unsubscribe?token=abc");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("omits the mailto: entry entirely when no sending address is known, rather than emitting mailto:undefined", () => {
    const headers = buildUnsubscribeHeaders("https://example.supabase.co/functions/v1/unsubscribe?token=abc");
    expect(headers["List-Unsubscribe"]).not.toContain("mailto:");
  });

  it("adds a mailto: alternative ahead of the link when a sending address is given", () => {
    const headers = buildUnsubscribeHeaders(
      "https://example.supabase.co/functions/v1/unsubscribe?token=abc",
      "admin@homequotelink.com",
    );
    expect(headers["List-Unsubscribe"]).toBe(
      "<mailto:admin@homequotelink.com?subject=unsubscribe&body=STOP>, " +
        "<https://example.supabase.co/functions/v1/unsubscribe?token=abc>",
    );
  });

  it("trims a sending address before using it, same as resolveBccCopy does elsewhere", () => {
    const headers = buildUnsubscribeHeaders("https://example.com/unsubscribe", "  admin@homequotelink.com  ");
    expect(headers["List-Unsubscribe"]).toContain("<mailto:admin@homequotelink.com?subject=unsubscribe&body=STOP>");
  });

  // The gap this guards against: receive-inbound-email's classifyReply() only
  // reads the message BODY, never the subject (see index.ts's `classifyReply(
  // bodyText)` call — subject is logged but never classified on). Most mail
  // clients open a mailto: link as an empty compose window, so a recipient who
  // hits Send without typing anything would produce a body of "" — which
  // classifyReply reads as unclassified, not unsubscribe, and nothing would
  // ever get suppressed. Prefilling the mailto body with STOP is what makes an
  // unedited one-click mailto send actually work; this test is what would fail
  // if that regex and this prefill ever drifted apart again.
  it("prefills a mailto body that classifyReply actually recognises as an unsubscribe", () => {
    const headers = buildUnsubscribeHeaders("https://example.com/unsubscribe", "admin@homequotelink.com");
    const mailtoMatch = headers["List-Unsubscribe"].match(/mailto:[^>]*body=([^&>]+)/);
    expect(mailtoMatch).not.toBeNull();
    const prefilledBody = decodeURIComponent(mailtoMatch![1]);
    expect(classifyReply(prefilledBody).classification).toBe("unsubscribe");
  });
});

// ── Bounce-rate circuit breaker ─────────────────────────────────────────────
//
// The threshold was 0.5 until 2026-08-27: sending only stopped once HALF of
// recent mail bounced, by which point the domain's reputation is already
// spent. These pin the tightened behaviour, and — more importantly — pin that
// a bad config value can never quietly switch the breaker off.

describe("resolveBounceCircuitSettings", () => {
  it("uses the defaults when nothing is configured", () => {
    expect(resolveBounceCircuitSettings()).toEqual(BOUNCE_CIRCUIT_DEFAULTS);
    expect(resolveBounceCircuitSettings({})).toEqual(BOUNCE_CIRCUIT_DEFAULTS);
  });

  it("halts well below the rate a mailbox provider would act on", () => {
    expect(BOUNCE_CIRCUIT_DEFAULTS.threshold).toBeLessThanOrEqual(0.2);
  });

  it("applies operator overrides", () => {
    expect(
      resolveBounceCircuitSettings({
        bounce_window_days: 14,
        bounce_min_sample: 50,
        bounce_threshold: 0.05,
      }),
    ).toEqual({ windowDays: 14, minSample: 50, threshold: 0.05 });
  });

  it("accepts numeric strings, since config is hand-edited JSON", () => {
    expect(resolveBounceCircuitSettings({ bounce_threshold: "0.25" }).threshold).toBe(0.25);
  });

  it.each([
    ["not a number", "abc"],
    ["null", null],
    ["NaN", Number.NaN],
    ["negative", -1],
    ["zero threshold, which would halt sending forever", 0],
    ["above 100%, which could never be met", 5],
  ])("falls back to the default threshold for %s", (_label, value) => {
    // The NaN case is the dangerous one: `rate >= NaN` is always false, so a
    // single bad value would leave the breaker looking configured while never
    // firing again.
    expect(resolveBounceCircuitSettings({ bounce_threshold: value }).threshold).toBe(
      BOUNCE_CIRCUIT_DEFAULTS.threshold,
    );
  });

  it("falls back per-field rather than discarding the whole config", () => {
    const settings = resolveBounceCircuitSettings({
      bounce_min_sample: 40,
      bounce_threshold: "nonsense",
    });
    expect(settings.minSample).toBe(40);
    expect(settings.threshold).toBe(BOUNCE_CIRCUIT_DEFAULTS.threshold);
  });
});

describe("evaluateBounceCircuit", () => {
  const settings = BOUNCE_CIRCUIT_DEFAULTS;

  it("does not trip below the sample floor, however bad the rate", () => {
    // 5 of 5 is a 100% bounce rate, but five sends is not evidence of a
    // campaign-wide problem — and stopping on it would make the breaker fire
    // on the first day of any new push.
    expect(evaluateBounceCircuit(5, 5, settings).tripped).toBe(false);
  });

  it("trips once the sample is large enough and the rate is over", () => {
    const decision = evaluateBounceCircuit(20, 3, settings);
    expect(decision.tripped).toBe(true);
    expect(decision.rate).toBeCloseTo(0.15);
    expect(decision.reason).toMatch(/3 of the last 20/);
    expect(decision.reason).toMatch(/15\.0%/);
  });

  it("does not trip just under the threshold", () => {
    expect(evaluateBounceCircuit(100, 14, settings).tripped).toBe(false);
  });

  it("leaves today's real numbers well clear", () => {
    // 1 bounce in 31 sends, 2026-08-27. The breaker must not be trained so
    // tight that ordinary address staleness stops the campaign.
    expect(evaluateBounceCircuit(31, 1, settings).tripped).toBe(false);
  });

  it("handles zero sends without dividing by zero", () => {
    const decision = evaluateBounceCircuit(0, 0, settings);
    expect(decision.tripped).toBe(false);
    expect(decision.rate).toBe(0);
  });

  it("treats negative or non-finite counts as zero rather than tripping", () => {
    expect(evaluateBounceCircuit(Number.NaN, Number.NaN, settings).tripped).toBe(false);
    expect(evaluateBounceCircuit(-5, -2, settings).tripped).toBe(false);
  });

  it("would have tripped where the old 50% threshold did not", () => {
    // The regression this change exists for: a campaign bouncing a fifth of
    // its mail used to sail straight through.
    const old = { windowDays: 7, minSample: 10, threshold: 0.5 };
    expect(evaluateBounceCircuit(40, 8, old).tripped).toBe(false);
    expect(evaluateBounceCircuit(40, 8, BOUNCE_CIRCUIT_DEFAULTS).tripped).toBe(true);
  });
});
