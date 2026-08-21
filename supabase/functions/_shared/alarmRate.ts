/**
 * Rate-based alarm checks.
 *
 * raiseAlarm() (see alarm.ts) fires once, immediately, for a single detected
 * condition — appropriate when the caller controls how often the check runs
 * (a cron canary, one inbound email at a time). This module is for the
 * opposite shape: a signal whose *rate* is set by an untrusted, unauthenticated
 * caller (a public endpoint), where firing once per event would itself become
 * a flood — every event past the threshold would insert another alarm row,
 * pushing every other alarm out of admin_recent_alarms's 50-row window within
 * seconds. See alarm.ts's header for why "written somewhere" and "seen" are
 * treated as different properties; a self-inflicted flood defeats that same
 * goal from the other direction.
 *
 * So each check here debounces: count matches in a window, and if over
 * threshold, raise at most one alarm per cooldown window.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { raiseAlarm } from "./alarm.ts";

const ALARM_KIND = "unsubscribe_token_misses";

/** Must match the error_message logRun() writes at unsubscribe/index.ts's `!business` branch. */
const MISS_ERROR_MESSAGE = "No business for token";

const WINDOW_HOURS = 6;
const THRESHOLD = 10;
const COOLDOWN_HOURS = 6;

/**
 * Raises `unsubscribe_token_misses` once THRESHOLD well-formed-but-unmatched
 * unsubscribe tokens land within WINDOW_HOURS, then stays quiet for
 * COOLDOWN_HOURS regardless of how many more misses arrive.
 *
 * Only counts "No business for token" — not "Invalid or missing token" (a
 * malformed token never reaches this code path's caller). A malformed token
 * is what random scanner traffic produces; it isn't evidence of anything.
 * A syntactically valid UUID that matches no business is specific: mailed
 * links don't produce random UUIDs, so it means either the mailed links are
 * wrong or a business row was deleted out from under a live token.
 *
 * Absolute threshold, not relative to a baseline — same reasoning as
 * receive-inbound-email's checkSuppressionRate: this endpoint has no traffic
 * history yet to be relative to.
 *
 * Cooldown check runs FIRST, before the count query, because it is the one
 * that must stay cheap exactly when request volume (and therefore load on
 * this check) is highest.
 */
export async function checkTokenMissRate(supabase: SupabaseClient, jobName: string): Promise<void> {
  const cooldownStart = new Date(Date.now() - COOLDOWN_HOURS * 3_600_000).toISOString();

  const { count: recentAlarms, error: cooldownError } = await supabase
    .from("job_run_logs")
    .select("id", { count: "exact", head: true })
    .eq("job_name", "alarm")
    .eq("metadata->>alarm_kind", ALARM_KIND)
    .gte("created_at", cooldownStart);

  // Same posture as checkSuppressionRate: a failure to check is NOT
  // fail-closed. There is no action to withhold — the miss already happened
  // and the response already went out; only the anomaly check is degraded.
  if (cooldownError) {
    console.error(`[${jobName}] could not check alarm cooldown: ${cooldownError.message}`);
    return;
  }
  if ((recentAlarms ?? 0) > 0) return;

  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  const { count, error } = await supabase
    .from("job_run_logs")
    .select("id", { count: "exact", head: true })
    .eq("job_name", jobName)
    .eq("error_message", MISS_ERROR_MESSAGE)
    .gte("created_at", windowStart);

  if (error) {
    console.error(`[${jobName}] could not check token-miss rate: ${error.message}`);
    return;
  }

  if ((count ?? 0) < THRESHOLD) return;

  await raiseAlarm(
    supabase,
    ALARM_KIND,
    `${count} unsubscribe requests in the last ${WINDOW_HOURS}h presented a well-formed token that ` +
      `matched no business (threshold ${THRESHOLD}). Either outreach emails are carrying broken ` +
      `unsubscribe links, or businesses with a live token are being deleted.`,
    { misses_in_window: count, window_hours: WINDOW_HOURS, threshold: THRESHOLD },
  );
}
