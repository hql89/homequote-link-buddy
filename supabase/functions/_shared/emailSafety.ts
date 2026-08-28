/**
 * Loop and runaway-volume guards for outbound email.
 *
 * Split out of mailer.ts, which pulls in a real `https://deno.land/...`
 * import for its SMTP client and so cannot be loaded under vitest (same
 * reason storageRefs.ts was split out of purge-archived/index.ts). This
 * module has no such dependency and is safe to unit-test directly.
 *
 * Both guards were ported after a real incident in a sibling project
 * (Mivos.ai, 2026-08): a notification mailed to its own sending address was
 * picked up by an inbound poller watching that mailbox, re-ingested as a new
 * lead, and produced another notification — indefinitely, ~1,000+ times,
 * before being caught. See the header comments on each function for how that
 * maps onto this project.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { raiseAlarm } from "./alarm.ts";

/** The subset of SmtpConfig these guards need — avoids importing mailer.ts. */
export interface SendingIdentity {
  fromEmail: string;
  smtpUsername: string;
}

/**
 * Refuses to send when the ACTUAL recipient is one of this project's own
 * sending identities — checked at the last moment, against the real `to`,
 * not against a default a caller might override.
 *
 * HQL's admin notification address (dgarcia89@gmail.com) differs from its
 * sending address (admin@homequotelink.com) today, and receive-inbound-email
 * never sends mail itself, so the exact Mivos loop can't reproduce as-is —
 * but neither of those is enforced by code, only by current configuration
 * and current design. This is the permanent version: a config change or a
 * future feature can never wire output back into input this way, because the
 * send itself refuses.
 *
 * Placement matters, per the same incident: checking a DEFAULT recipient
 * instead of the real one silently blocks every caller that passes an
 * explicit `to` (password resets, quote-request notifications, replies).
 * Callers must check `email.to`, the address actually being sent to — this
 * function only compares what it's given.
 */
export function isSelfAddressed(to: string, identity: SendingIdentity): boolean {
  const target = to.trim().toLowerCase();
  if (!target) return false;
  return (
    target === identity.fromEmail.trim().toLowerCase() ||
    target === identity.smtpUsername.trim().toLowerCase()
  );
}

export interface BccDecision {
  /** The address to BCC, or null to send with no BCC at all. */
  bcc: string | null;
  /** Set when a configured address was deliberately dropped. Never silent. */
  refused?: string;
}

/**
 * Decides whether a configured "send me a copy" BCC is safe to attach.
 *
 * This exists because a BCC is the one place a testing convenience can
 * reconstruct the exact Mivos loop `isSelfAddressed` was ported to prevent.
 * `admin@homequotelink.com` is both this project's sending identity AND the
 * mailbox the n8n IMAP bridge polls into `receive-inbound-email`. BCC outreach
 * there and every message we send is re-ingested as if it were a reply *from a
 * business* — and the outreach copy literally instructs "reply YES" and
 * mentions STOP, so the classifier would be reading our own words back as
 * customer intent. A copy to a mailbox nothing polls (a personal Gmail) is
 * fine; a copy to the sending identity is not.
 *
 * Drops the BCC rather than failing the send: the outreach reaching the
 * business is the thing that matters, and a misconfigured testing copy must
 * never block real mail. The `refused` reason is returned so the caller can
 * surface it loudly instead of leaving the admin wondering where copies went.
 */
export function resolveBccCopy(
  configured: string | null | undefined,
  identity: SendingIdentity,
): BccDecision {
  const candidate = (configured ?? "").trim();
  if (!candidate) return { bcc: null };

  if (isSelfAddressed(candidate, identity)) {
    return {
      bcc: null,
      refused:
        `BCC copy to ${candidate} was dropped: it is one of this project's own sending ` +
        `addresses, and the inbound bridge polls that mailbox — copies would be re-ingested ` +
        `as business replies. Use an address nothing polls (e.g. a personal inbox).`,
    };
  }

  // Not a validator — just enough shape checking that an obvious typo becomes a
  // visible refusal here rather than an opaque SMTP rejection of the whole message.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate)) {
    return { bcc: null, refused: `BCC copy to "${candidate}" was dropped: not a valid email address.` };
  }

  return { bcc: candidate };
}

/**
 * RFC 8058 one-click unsubscribe headers for outreach mail.
 *
 * Split out here rather than built inline in mailer.ts for the same reason
 * isSelfAddressed/resolveBccCopy live here: mailer.ts pulls in a real SMTP
 * client import and cannot be unit-tested, so anything worth a regression
 * test belongs in this file instead.
 *
 * Both headers together are what lets Gmail/Yahoo/Outlook show their own
 * "Unsubscribe" button next to the sender name, and what a mail client's
 * automated one-click POST (List-Unsubscribe-Post: List-Unsubscribe=One-Click)
 * targets — neither existed on outreach mail before this, which is also why
 * the copy itself had no working opt-out: there was nothing to point it at.
 *
 * `mailtoAddress` adds a second, RFC 8058-permitted URI for clients that
 * prefer a mailto: unsubscribe over a link — omitted entirely (not emitted
 * as a broken `mailto:undefined`) when no sending address is known yet.
 * Its body is prefilled with `STOP`, not left blank: most mail clients open
 * a mailto: link as an empty compose window, and receive-inbound-email's
 * classifyReply() only reads the message BODY, never the subject — an
 * unedited send with only "subject=unsubscribe" and no body would come back
 * as `unclassified`, not `unsubscribe`, and silently never suppress anyone.
 * Prefilling the body means even an unedited send still matches
 * classifyReply()'s existing UNSUBSCRIBE_RE, with no classifier change
 * needed. See tests/unit/emailSafety.test.ts for the cross-check against
 * that regex.
 */
export function buildUnsubscribeHeaders(
  unsubscribeUrl: string,
  mailtoAddress?: string | null,
): Record<string, string> {
  const address = mailtoAddress?.trim();
  const mailtoUri = address ? `<mailto:${address}?subject=unsubscribe&body=STOP>, ` : "";
  return {
    "List-Unsubscribe": `${mailtoUri}<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface CircuitBreakerResult {
  tripped: boolean;
  reason?: string;
}

/** Minimal query surface this needs — matches supabase-js's builder shape closely enough to mock. */
export interface EmailSendLogReader {
  from(table: "email_send_log"): {
    select(
      columns: string,
      opts: { count: "exact"; head: true },
    ): { gte(column: string, value: string): PromiseLike<{ count: number | null; error: { message: string } | null }> };
  };
}

export interface AdminSettingsWriter {
  from(table: "admin_settings"): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { setting_value: unknown } | null }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Volume-based circuit breaker, independent of bounce detection.
 *
 * HQL's other safeguard against a bad campaign is send-outreach-drip's
 * bounce-rate check (evaluateBounceCircuit, below). When this was written that
 * check was inert, because it depends on the inbound email bridge and
 * `select count(*) from inbound_emails` was 0. That is no longer true — as of
 * 2026-08-27 there are 19 inbound rows, and a real bounce on 2026-08-23 was
 * classified and flipped `email_send_log.status` to `bounced`, so the bounce
 * breaker is now genuinely fed.
 *
 * They remain complementary rather than redundant, and this one still needs
 * nothing external: it counts recent rows in `email_send_log` itself, across
 * every sender. Volume catches a runaway loop within minutes; bounce rate
 * catches a campaign mailing addresses that do not exist, which is slower and
 * invisible to a volume count.
 *
 * Threshold: 250 sends in 10 minutes. Reasoning, not a guess: the largest
 * legitimate burst this project can currently produce is one
 * send-outreach-drip run — up to 50 Email-1s and 50 Email-2s, 100 total.
 * 250 gives roughly 2.5x headroom above that so a real batch never trips it,
 * while still catching a genuine runaway well before Mivos's ~1,000+ scale.
 * If real traffic patterns need a different number, that's a one-line change
 * here, not a redesign.
 *
 * FAILS CLOSED when its own query errors — refuses the send rather than
 * assuming volume is fine. This is the specific weakness flagged in Mivos's
 * own breaker: it counts off a log table whose own writer (logEmailSend,
 * here) deliberately swallows its write errors, so a lost log entry never
 * blocks a send. That's the right call for the log itself, but wrong for a
 * safety check built on top of it — if this can't determine how much has
 * gone out, that must mean "stop", not "assume zero and continue".
 *
 * Trips by flipping `smtp_config.enabled` to false, which mailer.ts's
 * sendViaSmtp() already checks — the same kill switch an admin uses, so
 * recovery is the same one existing control: Admin -> Settings -> Email ->
 * Enabled. It does not re-enable itself, deliberately: automatic recovery
 * from an unexplained volume spike just restarts the incident.
 */
export async function checkVolumeCircuitBreaker(
  supabase: SupabaseClient,
): Promise<CircuitBreakerResult> {
  const WINDOW_MINUTES = 10;
  const THRESHOLD = 250;

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const { count, error } = await (supabase as unknown as EmailSendLogReader)
    .from("email_send_log")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", windowStart);

  if (error) {
    return {
      tripped: true,
      reason: `Circuit breaker: could not verify recent send volume (${error.message}) — refusing to send rather than assume it is safe.`,
    };
  }

  if ((count ?? 0) < THRESHOLD) {
    return { tripped: false };
  }

  const reason =
    `Circuit breaker tripped: ${count} emails sent in the last ${WINDOW_MINUTES} minutes ` +
    `(threshold ${THRESHOLD}). Disabling email sending project-wide.`;

  // Merge, never replace: setting_value also holds smtpHost/Port/Username/
  // Password/fromEmail/fromName/adminNotificationEmail. Writing {enabled:
  // false} directly would silently destroy the rest of the admin's mail
  // configuration — the breaker is meant to pause sending, not erase how to
  // send once it is re-enabled.
  const writer = supabase as unknown as AdminSettingsWriter;
  const { data: current } = await writer
    .from("admin_settings")
    .select("setting_value")
    .eq("setting_key", "smtp_config")
    .maybeSingle();

  const { error: disableError } = await writer
    .from("admin_settings")
    .update({
      setting_value: { ...((current?.setting_value as Record<string, unknown>) ?? {}), enabled: false },
    })
    .eq("setting_key", "smtp_config");

  // Best-effort: this send is refused either way via the tripped result, so a
  // failure here means only that the NEXT send has to trip the breaker again
  // rather than being caught by the disabled flag.
  if (disableError) {
    console.error("[checkVolumeCircuitBreaker] failed to disable smtp_config.enabled:", disableError.message);
  }

  // Raised regardless of whether the kill switch could be written — the
  // condition is the same either way, and a failure to disable makes the
  // alarm MORE important, not less.
  await raiseAlarm(supabase, "email_circuit_breaker", reason, {
    sends_in_window: count,
    window_minutes: WINDOW_MINUTES,
    threshold: THRESHOLD,
    sending_disabled: !disableError,
    ...(disableError ? { disable_error: disableError.message } : {}),
  });

  return { tripped: true, reason };
}

// ── Bounce-rate circuit breaker ─────────────────────────────────────────────

/** Defaults, used whenever `outreach_config` does not override them. */
export const BOUNCE_CIRCUIT_DEFAULTS = {
  windowDays: 7,
  /**
   * Below this many sends in the window, no rate is trustworthy enough to act
   * on. At a 5/day cap this accumulates in four days, well inside the window.
   */
  minSample: 20,
  /**
   * 15%. The campaign's real rate is 3.2% (1 bounce in 31 sends as of
   * 2026-08-27), so ordinary address staleness has wide clearance, while
   * still tripping far below the sustained rate at which mailbox providers
   * start penalising a domain.
   *
   * Was 0.5 until 2026-08-27. A breaker that waits for half of all mail to
   * fail does not protect a sending reputation; by then the damage is done.
   * The sample floor rose from 10 with it — at 15%, a sample of 10 would halt
   * on 2 bounces, close enough to noise to stop the campaign for no reason.
   */
  threshold: 0.15,
} as const;

export interface BounceCircuitConfig {
  bounce_window_days?: unknown;
  bounce_min_sample?: unknown;
  bounce_threshold?: unknown;
}

export interface BounceCircuitSettings {
  windowDays: number;
  minSample: number;
  threshold: number;
}

/**
 * Reads the tunables out of `outreach_config`, falling back per-field.
 *
 * Every value is range-checked, not merely type-checked. A threshold of 0
 * would halt sending permanently and a threshold of 5 would disable the
 * breaker outright; both are far likelier to be a typo than an intention. The
 * NaN case matters most: `bounces / sends >= NaN` is always false, so a single
 * malformed config value would silently turn the breaker off while leaving it
 * looking configured.
 */
export function resolveBounceCircuitSettings(config: BounceCircuitConfig = {}): BounceCircuitSettings {
  const num = (raw: unknown, min: number, max: number, fallback: number): number => {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) return fallback;
    return value;
  };

  return {
    windowDays: num(config.bounce_window_days, 1, 90, BOUNCE_CIRCUIT_DEFAULTS.windowDays),
    minSample: num(config.bounce_min_sample, 1, 10_000, BOUNCE_CIRCUIT_DEFAULTS.minSample),
    // Upper bound 1 rather than Infinity: a "threshold" above 100% cannot ever
    // be met, which is indistinguishable from having no breaker at all.
    threshold: num(config.bounce_threshold, 0.01, 1, BOUNCE_CIRCUIT_DEFAULTS.threshold),
  };
}

export interface BounceCircuitDecision {
  tripped: boolean;
  sends: number;
  bounces: number;
  rate: number;
  settings: BounceCircuitSettings;
  reason?: string;
}

/**
 * Decides whether recent bounce rate should stop the campaign.
 *
 * Pure, and separated from the queries for the same reason `pickVariant` and
 * `remainingDailyBudget` were: the arithmetic that decides whether real email
 * goes out should be directly testable, without a database.
 */
export function evaluateBounceCircuit(
  sends: number,
  bounces: number,
  settings: BounceCircuitSettings,
): BounceCircuitDecision {
  const safeSends = Number.isFinite(sends) && sends > 0 ? Math.floor(sends) : 0;
  const safeBounces = Number.isFinite(bounces) && bounces > 0 ? Math.floor(bounces) : 0;
  const rate = safeSends === 0 ? 0 : safeBounces / safeSends;

  if (safeSends < settings.minSample) {
    return { tripped: false, sends: safeSends, bounces: safeBounces, rate, settings };
  }

  if (rate < settings.threshold) {
    return { tripped: false, sends: safeSends, bounces: safeBounces, rate, settings };
  }

  return {
    tripped: true,
    sends: safeSends,
    bounces: safeBounces,
    rate,
    settings,
    reason:
      `${safeBounces} of the last ${safeSends} outreach emails bounced ` +
      `(${(rate * 100).toFixed(1)}%, limit ${(settings.threshold * 100).toFixed(0)}%). ` +
      `Sending is stopped until the cause is fixed — continuing would damage the domain's ` +
      `sending reputation.`,
  };
}
