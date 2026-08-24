/**
 * Pure logic for the delivery canary.
 *
 * The canary answers a question none of this project's other safeguards can:
 * "is outbound email actually arriving right now?" Everything else (the
 * delivery_verified_at gate, bounce classification) is either a stale human
 * assertion or dependent on the n8n inbound bridge, which has never
 * delivered a single message. The canary needs nothing but a working outbox
 * and a separate, working inbox watching for its own probes.
 *
 * Design ported from a sibling project (Mivos.ai) after a real incident
 * there: a self-addressed notification, re-ingested by an inbound poller as
 * a new lead, looped ~1,000+ times. Their canary confirms via a Gmail API
 * trigger, not IMAP — which matters here specifically because it means the
 * confirm leg does NOT depend on HQL's own dead IMAP bridge. The probe
 * recipient can be (and is) a Gmail address entirely separate from
 * anything the outreach drip could ever mail.
 *
 * Split out from the edge functions that use it because both of those pull
 * in mailer.ts, which has a real network import (SMTPClient) and so cannot
 * be loaded under vitest — same reason emailSafety.ts and storageRefs.ts
 * were split out. This module has no such dependency.
 */

/** How long a probe may go unconfirmed before it's treated as a failure. */
export const GRACE_MINUTES = 20;

/**
 * Target cadence for new probes. Enforced by shouldSendNewProbe, not a cron
 * interval.
 *
 * 23 hours, not 24, for a daily probe — deliberately. The cron job fires at
 * a fixed wall-clock time, but the probe actually sends a few seconds later
 * (HTTP dispatch + SMTP handshake), so each day's last_sent_at drifts a
 * little later than the one before. At a flat 1440 the very next run would
 * measure ~23h59m since the last probe, decide "not due yet", and skip —
 * silently turning a daily canary into a no-op. The hour of headroom
 * absorbs that drift while still making a second probe in the same day
 * impossible (a manual re-invoke minutes later is correctly a no-op).
 */
export const PROBE_INTERVAL_MINUTES = 23 * 60;

const SUBJECT_PREFIX = "HomeQuoteLink Delivery Probe";

/** Matches a bare UUID — permissive on where it sits in the subject line. */
const TOKEN_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Whether a sent-but-unconfirmed probe has been silent long enough to treat
 * as a failure. Strictly greater-than: exactly at the boundary is not yet
 * overdue, avoiding a race with a confirmation arriving right at the edge.
 */
export function isProbeOverdue(sentAt: Date, now: Date, graceMinutes: number = GRACE_MINUTES): boolean {
  const ageMs = now.getTime() - sentAt.getTime();
  return ageMs > graceMinutes * 60_000;
}

/**
 * Whether it's time to send a new probe, given when the last one went out.
 * No probe ever sent counts as due immediately.
 */
export function shouldSendNewProbe(
  lastSentAt: Date | null,
  now: Date,
  intervalMinutes: number = PROBE_INTERVAL_MINUTES,
): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= intervalMinutes * 60_000;
}

/**
 * Builds the probe's subject line. The token sits in the subject rather than
 * only the body specifically so the n8n watcher can filter and extract it
 * with a plain Gmail search (`subject:"HomeQuoteLink Delivery Probe"`)
 * without needing to open the message body.
 */
export function buildProbeSubject(token: string): string {
  return `${SUBJECT_PREFIX} #${token}`;
}

/**
 * Recovers the token from a subject line the way the n8n watcher will need
 * to. Returns null rather than throwing on anything that doesn't match —
 * the watcher will see subjects this was never meant to parse (replies,
 * forwards) and must skip them, not error.
 */
export function extractTokenFromSubject(subject: string): string | null {
  const match = subject.match(TOKEN_RE);
  return match ? match[1].toLowerCase() : null;
}
