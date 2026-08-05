/**
 * Alarms — conditions a human needs to know about, written somewhere a push
 * integration can watch.
 *
 * Two things are deliberately separate here:
 *
 *   RECORD  — always to the database (`job_run_logs` with job_name 'alarm').
 *             This is the durable, primary record. It must not depend on
 *             email, because the first alarms this project will ever raise
 *             are about email being broken, and an emailed alert about email
 *             being broken cannot arrive.
 *
 *   NOTICE  — a push to something that isn't email and isn't a page someone
 *             has to remember to visit. NOT implemented here: it needs an
 *             n8n Slack/Telegram/SMS node watching for these rows, which is
 *             infrastructure, not code. See the query at the bottom of this
 *             comment for exactly what to watch.
 *
 * Why the distinction is called out rather than assumed: a sibling project
 * (Mivos.ai) supplied two concrete failures of the record-only approach —
 * a daily cron that silently never fired for ~2 weeks with everything needed
 * to notice sitting in the database, and a 1,134-email flood that ran ~20
 * hours and was ultimately discovered by the hosting provider suspending the
 * account rather than by any log. "Written where someone could see it" and
 * "seen" are different properties. This module gets the first one right and
 * makes the second one a small, well-defined integration rather than a
 * redesign.
 *
 * To wire the push, watch for:
 *   select * from job_run_logs
 *    where job_name = 'alarm' and created_at > now() - interval '5 minutes';
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/** Distinct job_name so alarms are trivially separable from ordinary job runs. */
const ALARM_JOB_NAME = "alarm";

export type AlarmKind =
  /** Outbound volume breaker tripped; sending has been disabled project-wide. */
  | "email_circuit_breaker"
  /** Unsubscribe auto-suppressions arriving far above the normal rate. */
  | "suppression_spike"
  /** An automatic action's write failed, so the action did not actually take effect. */
  | "action_write_failed";

/**
 * Records an alarm. Never throws.
 *
 * Swallowing its own errors is correct here for the same reason it is in
 * logEmailSend: an alarm that cannot be written must not take down the
 * request that was trying to raise it. The console.error is the last-resort
 * trace when even the database write fails.
 */
export async function raiseAlarm(
  supabase: SupabaseClient,
  kind: AlarmKind,
  summary: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabase.from("job_run_logs").insert({
      job_name: ALARM_JOB_NAME,
      status: "failure",
      attempts: 1,
      duration_ms: null,
      error_message: summary,
      metadata: { alarm_kind: kind, ...detail },
    });

    if (error) {
      console.error(`[alarm:${kind}] FAILED to record alarm: ${error.message} — ${summary}`);
      return;
    }
    console.error(`[alarm:${kind}] ${summary}`);
  } catch (err) {
    console.error(
      `[alarm:${kind}] FAILED to record alarm: ${err instanceof Error ? err.message : String(err)} — ${summary}`,
    );
  }
}
