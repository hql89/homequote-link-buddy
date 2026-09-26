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
  | "action_write_failed"
  /** A delivery-canary probe was unconfirmed past its grace period, or could not be sent at all. */
  | "delivery_canary_failed"
  /** A well-formed unsubscribe token repeatedly matched no business — links may be broken. */
  | "unsubscribe_token_misses"
  /** Outreach halted itself: too many of the recent sends bounced. */
  | "outreach_bounce_rate"
  /** A scheduled job has failed several runs in a row and nobody has noticed. */
  | "job_failing_repeatedly";

/**
 * Records an alarm. Never throws.
 *
 * Swallowing its own errors is correct here for the same reason it is in
 * logEmailSend: an alarm that cannot be written must not take down the
 * request that was trying to raise it. The console.error is the last-resort
 * trace when even the database write fails.
 */
/**
 * How long after one alarm of a kind before another of the same kind mails.
 *
 * The record always happens; only the email is throttled. Without this a
 * condition that re-fires hourly (the delivery canary did exactly that for a
 * week in August) turns the inbox into the thing that gets ignored, which is
 * the failure this push exists to prevent.
 */
const EMAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Pushes the alarm to the admin's inbox, on top of the database record.
 *
 * The module header explains why RECORD and NOTICE are separate, and that
 * reasoning still holds for one case: an alarm about email being broken
 * cannot arrive by email. It is left to try anyway rather than being
 * special-cased, because the alternative — deciding here which alarms are
 * "about email" — is a guess that goes stale, and a failed send costs
 * nothing (the banner still has it). Everything else, an expired API key
 * most of all, reaches someone the same morning instead of waiting for them
 * to happen to open the admin.
 *
 * Never throws and never blocks the record: called after the insert, with
 * its own try/catch. notify-admin-email does not itself raise alarms, so
 * there is no loop back into here.
 */
async function emailAlarm(
  supabase: SupabaseClient,
  kind: AlarmKind,
  summary: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const since = new Date(Date.now() - EMAIL_COOLDOWN_MS).toISOString();
    const { count } = await supabase
      .from("job_run_logs")
      .select("id", { count: "exact", head: true })
      .eq("job_name", ALARM_JOB_NAME)
      .eq("metadata->>alarm_kind", kind)
      .gte("created_at", since);

    // >1 rather than >0: the row this alarm just wrote is itself inside the
    // window, so the first alarm of a kind must still send.
    if ((count ?? 0) > 1) return;

    const url = Deno.env.get("SUPABASE_URL");
    if (!url) return;

    await fetch(`${url}/functions/v1/notify-admin-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationType: "alarm",
        alarmData: { kind, summary, detail: JSON.stringify(detail) },
      }),
    });
  } catch (err) {
    console.error(`[alarm:${kind}] could not email the alarm:`, err instanceof Error ? err.message : err);
  }
}

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
    await emailAlarm(supabase, kind, summary, detail);
  } catch (err) {
    console.error(
      `[alarm:${kind}] FAILED to record alarm: ${err instanceof Error ? err.message : String(err)} — ${summary}`,
    );
  }
}
