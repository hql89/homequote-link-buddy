/**
 * Plain-English explanations for the small set of job_run_logs error messages
 * that are fixed string literals in the edge functions — as opposed to a
 * Postgres or network error's dynamic .message, which can't be pre-written
 * because its text isn't known until it happens.
 *
 * Mirrors alarmDisplay.ts's approach (translate a code-facing string into a
 * sentence an admin can act on) but for job_run_logs.error_message instead of
 * an alarm_kind. Same posture on the unknown case: no match returns null and
 * the raw message still renders on its own — this only ever adds to what's
 * shown, never replaces or hides it.
 *
 * Catalogued directly against every logRun()/raiseAlarm() call site in
 * supabase/functions/ on 2026-08-21 — entries here are exactly the literals
 * that exist in the code today, not guesses about what might appear.
 */

interface KnownError {
  jobName: string;
  /** Exact match, or a substring test for messages that can arrive joined with other (dynamic) text. */
  match: string | ((message: string) => boolean);
  explanation: string;
}

const KNOWN_ERRORS: KnownError[] = [
  {
    jobName: "unsubscribe",
    match: "Invalid or missing token",
    explanation:
      "The link had no token, or one that isn't even shaped like a real one — almost always a bot " +
      "or scanner hitting the URL blind, not a real customer's broken link.",
  },
  {
    jobName: "unsubscribe",
    match: "No business for token",
    explanation:
      "The link's token was shaped like a real one but didn't match any business — either an " +
      "outreach email is carrying a broken link, or the business it pointed to was deleted. A few of " +
      "these are informational; 10+ within 6 hours raises a proper alarm on its own.",
  },
  {
    jobName: "submit-directory-lead",
    match: "Business has no email on file.",
    explanation:
      "A homeowner's quote request was saved fine — the business just has no email address on file, " +
      "so there was nowhere to send the notification. Add an email for that business to fix it going forward.",
  },
  {
    jobName: "ingest-business",
    match: (m) => m.includes("No active Email 1 template variant"),
    explanation:
      "The new listing was created fine — the welcome email was skipped because every Email 1 " +
      "template variant is turned off. Activate one in Admin → Outreach if it should be sending.",
  },
  {
    jobName: "enrich-business-email",
    match: "Perplexity is not configured. Go to Admin → Settings to add a key.",
    explanation: "No Perplexity API key has ever been saved. Add one in Admin → Settings to enable enrichment.",
  },
  {
    jobName: "enrich-business-email",
    match: "Perplexity is not enabled. Go to Admin → Settings.",
    explanation: "Perplexity is configured but switched off, or missing its key. Check Admin → Settings.",
  },
  {
    jobName: "publish-scheduled-posts",
    match: "Unknown error",
    explanation:
      "A scheduled post failed to publish in a way that didn't leave a normal error message behind. " +
      "Uncommon — worth a look if it keeps happening, since the real cause isn't visible here.",
  },
  {
    jobName: "send-outreach-drip",
    match: (m) => m.includes("Email 1 skipped: no active template variant."),
    explanation:
      "Every Email 1 (verification) template variant is turned off, so that stage was skipped for " +
      "the whole run — a settings issue, not a per-business failure. Check Admin → Outreach.",
  },
  {
    jobName: "send-outreach-drip",
    match: (m) => m.includes("Email 2 skipped: no active template variant."),
    explanation:
      "Every Email 2 (claim-link) template variant is turned off, so that stage was skipped for the " +
      "whole run — a settings issue, not a per-business failure. Check Admin → Outreach.",
  },
];

/**
 * Returns a plain-English explanation for a known error_message, or null when
 * the message doesn't match anything catalogued — which includes every
 * dynamic Postgres/network error, since those can't be known in advance.
 */
export function explainRunError(jobName: string, errorMessage: string | null): string | null {
  if (!errorMessage) return null;
  const known = KNOWN_ERRORS.find(
    (k) =>
      k.jobName === jobName &&
      (typeof k.match === "string" ? k.match === errorMessage : k.match(errorMessage)),
  );
  return known?.explanation ?? null;
}
