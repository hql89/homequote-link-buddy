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
 * HQL's existing safeguard against a bad campaign is send-outreach-drip's
 * bounce-rate check — but that depends on the n8n inbound bridge actually
 * running, and it has never delivered a single message
 * (`select count(*) from inbound_emails` = 0 as of 2026-08). This breaker
 * needs nothing external: it counts recent rows in `email_send_log` itself,
 * across every sender, and works today.
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
