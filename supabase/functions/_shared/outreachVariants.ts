/**
 * Pure logic for outreach rate-limiting and A/B variant selection.
 *
 * Split out from send-outreach-drip for the same reason emailSafety.ts and
 * canary.ts were split out of their callers: that function imports mailer.ts,
 * which has a real `https://deno.land/...` SMTP import and so cannot be
 * loaded under vitest. Nothing here has any dependency at all, so the two
 * pieces of arithmetic that decide *how many* real emails go out and *which
 * copy* they carry are directly unit-testable.
 *
 * Both functions exist because of a specific failure mode. The cap was
 * previously `BATCH_LIMIT = 50` applied per invocation, so two runs in one
 * day sent 100 — the admin-facing number meant nothing. Variant selection is
 * new: before this, copy was a hardcoded constant with no way to change or
 * compare it.
 */

/** A candidate template variant, as stored in `outreach_template_variants`. */
export interface TemplateVariant {
  variant_key: string;
  subject: string;
  body: string;
  weight: number;
  is_active: boolean;
}

/**
 * How many emails this run may still send today.
 *
 * `sentToday` is counted from `outreach_sends` rather than from anything on
 * `businesses`, because the two timestamp columns there record *the latest*
 * send per business per stage — they cannot answer "how many went out since
 * midnight" at all. Clamped at zero so a limit lowered below the count
 * already sent stops sending rather than going negative and, in the caller's
 * `.limit()`, wrapping into something enormous.
 */
export function remainingDailyBudget(dailyLimit: number, sentToday: number): number {
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) return 0;
  if (!Number.isFinite(sentToday) || sentToday < 0) return Math.floor(dailyLimit);
  return Math.max(0, Math.floor(dailyLimit) - Math.floor(sentToday));
}

/**
 * Start of the current UTC day, as an ISO string — the boundary the daily
 * budget is counted from.
 *
 * Deliberately UTC and not the operator's local timezone: the cron job that
 * drives this is scheduled in UTC, and a cap that resets at a different
 * moment than the job fires is how you get two "days" worth of sends in one
 * calendar day at the seam.
 */
export function startOfUtcDay(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Picks one variant, weighted, from the active ones.
 *
 * Returns null when nothing is eligible — an admin can deactivate every
 * variant for a stage, and the caller must treat that as a loud "nothing to
 * send with" rather than quietly falling back to hardcoded copy the admin
 * thought they had replaced.
 *
 * `random` is injectable purely so the distribution can be asserted in a
 * test; production passes nothing and gets Math.random.
 */
export function pickVariant(
  variants: TemplateVariant[],
  random: () => number = Math.random,
): TemplateVariant | null {
  // A non-positive weight means "never send this", which is distinct from
  // is_active=false only in that it survives without the admin toggling it.
  const eligible = variants.filter((v) => v.is_active && Number.isFinite(v.weight) && v.weight > 0);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  const total = eligible.reduce((sum, v) => sum + v.weight, 0);
  // Clamped because a random source returning exactly 1 (or, if a caller
  // passes something odd, >1) would otherwise fall past every bucket and
  // return undefined at the end.
  const target = Math.min(Math.max(random(), 0), 0.999999999) * total;

  let cursor = 0;
  for (const variant of eligible) {
    cursor += variant.weight;
    if (target < cursor) return variant;
  }
  return eligible[eligible.length - 1];
}
