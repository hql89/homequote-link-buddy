/**
 * email-canary
 *
 * Answers the one question no other safeguard in this project can: is
 * outbound email actually arriving right now? Everything else is either a
 * stale human assertion (delivery_verified_at) or dependent on the n8n
 * inbound bridge, which has never delivered a single message.
 *
 * Each invocation does two independent things:
 *
 *   1. Checks previously-sent probes for ones that have gone unconfirmed
 *      past the grace period and alarms each one exactly once
 *      (alarm_raised_at is set so a persistent outage doesn't re-alarm on
 *      the same row every time this runs).
 *   2. Sends a new probe if enough time has passed since the last one
 *      (shouldSendNewProbe — once a day by default).
 *
 * Checked once a day (cron schedule set in admin_toggle_cron_job). A tighter
 * check interval would catch an overdue probe sooner — the 20-minute grace
 * period only bites at check time, so daily checks mean up to ~a day's
 * detection latency for the "SMTP accepted it and silently discarded it"
 * failure mode specifically (a synchronous send failure is still caught
 * immediately regardless of check frequency, inside the same invocation
 * that attempts the send, and is what every canary failure so far has
 * been). Slowed from hourly to daily at the user's explicit request
 * (2026-08-24): one probe an hour was more mail than the signal justified.
 * Scheduled an hour ahead of the outreach drip so a delivery problem
 * surfaces before the day's real sends go out — see migration
 * 20260824020000.
 *
 * The confirming half lives in confirm-canary and is driven by a SEPARATE
 * system: an n8n workflow with a Gmail API trigger (not IMAP — see
 * _shared/canary.ts's header for why that distinction matters here) watching
 * the probe recipient's inbox and posting the token back on receipt. That
 * n8n workflow is infrastructure this function cannot set up; without it,
 * every probe will correctly alarm as unconfirmed, which is not a bug.
 *
 * Auth: none beyond verify_jwt=false, matching send-outreach-drip — the
 * closest analog (also a cron-invoked bulk-adjacent sender). Worth being
 * explicit that this is a real, if established, tradeoff: anyone with the
 * project's publishable key can trigger a probe send. The blast radius is
 * one email to a fixed internal address plus a row in a table nothing acts
 * on, so it was not judged worth diverging from the existing pattern.
 */
import { serviceRoleKey as readServiceRoleKey } from "../_shared/supabaseKeys.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { corsHeaders, json, logRun } from "../_shared/directory.ts";
import { loadSmtpConfig, sendOutreachEmail } from "../_shared/mailer.ts";
import { raiseAlarm } from "../_shared/alarm.ts";
import { isProbeOverdue, shouldSendNewProbe, buildProbeSubject, GRACE_MINUTES } from "../_shared/canary.ts";

const JOB_NAME = "email-canary";

interface ProbeRow {
  id: string;
  sent_at: string;
}

async function alarmOverdueProbes(supabase: SupabaseClient, now: Date): Promise<number> {
  const { data: pending, error } = await supabase
    .from("email_canary_probes")
    .select("id, sent_at")
    .is("confirmed_at", null)
    .is("alarm_raised_at", null)
    .order("sent_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error(`[${JOB_NAME}] could not query pending probes: ${error.message}`);
    return 0;
  }

  let alarmed = 0;
  for (const probe of (pending ?? []) as ProbeRow[]) {
    const sentAt = new Date(probe.sent_at);
    if (!isProbeOverdue(sentAt, now)) continue;

    const ageMinutes = Math.round((now.getTime() - sentAt.getTime()) / 60_000);
    await raiseAlarm(
      supabase,
      "delivery_canary_failed",
      `Delivery canary probe sent ${ageMinutes} minutes ago has not been confirmed ` +
        `(grace period ${GRACE_MINUTES}m). Outbound email may not be arriving.`,
      { probe_id: probe.id, sent_at: probe.sent_at, age_minutes: ageMinutes },
    );

    const { error: markError } = await supabase
      .from("email_canary_probes")
      .update({ alarm_raised_at: now.toISOString() })
      .eq("id", probe.id)
      .is("alarm_raised_at", null); // avoids a double-alarm race between overlapping invocations

    if (markError) {
      console.error(`[${JOB_NAME}] alarmed probe ${probe.id} but failed to mark it: ${markError.message}`);
    }
    alarmed++;
  }
  return alarmed;
}

async function maybeSendProbe(supabase: SupabaseClient, now: Date): Promise<{ sent: boolean; reason?: string }> {
  const { data: latest, error: latestErr } = await supabase
    .from("email_canary_probes")
    .select("sent_at")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    console.error(`[${JOB_NAME}] could not check last probe time: ${latestErr.message}`);
    return { sent: false, reason: `could not check last probe time: ${latestErr.message}` };
  }

  const lastSentAt = latest ? new Date(latest.sent_at) : null;
  if (!shouldSendNewProbe(lastSentAt, now)) {
    return { sent: false, reason: "not due yet" };
  }

  const { config } = await loadSmtpConfig(supabase);
  const recipient = config?.adminNotificationEmail?.trim();
  if (!recipient) {
    const reason = "admin_settings.smtp_config.adminNotificationEmail is not set — nowhere to send the probe.";
    console.error(`[${JOB_NAME}] ${reason}`);
    return { sent: false, reason };
  }

  // The token is the row's own id — reserve it with an insert BEFORE
  // sending, so if the process dies mid-send there is still a row an
  // operator can find, rather than a probe that was attempted but leaves no
  // trace at all.
  const { data: inserted, error: insertErr } = await supabase
    .from("email_canary_probes")
    .insert({ sent_at: now.toISOString(), send_status: "sent" })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    const reason = `could not reserve a probe row: ${insertErr?.message}`;
    console.error(`[${JOB_NAME}] ${reason}`);
    return { sent: false, reason };
  }

  const token = inserted.id as string;
  const subject = buildProbeSubject(token);

  const result = await sendOutreachEmail(
    config,
    {
      to: recipient,
      subject,
      text:
        `This is an automated delivery check from HomeQuoteLink.\n\n` +
        `Token: ${token}\n\n` +
        `If you are reading this in your inbox, outbound email is working. ` +
        `No action is needed — an automated watcher confirms this back automatically.`,
    },
    {
      supabase,
      jobName: JOB_NAME,
      emailType: "delivery_probe",
      recipientKind: "admin",
    },
  );

  if (!result.success) {
    // A synchronous send failure is a STRONGER signal than "unconfirmed
    // after 20 minutes" — it means delivery is broken right now, not
    // possibly-broken-eventually. Alarmed immediately rather than waiting
    // for the grace period to elapse on a probe that could never have
    // succeeded.
    //
    // alarm_raised_at is set HERE, not left for alarmOverdueProbes() to set
    // later — this row already got its alarm. Without this, the overdue
    // sweep would find it again once the grace period passed (it queries
    // alarm_raised_at IS NULL) and alarm it a SECOND time, with a less
    // accurate message ("unconfirmed" rather than "failed to send"). Caught
    // by checking the marker manually during live verification, not by any
    // test — worth a regression test precisely because it was this easy to
    // miss.
    await supabase
      .from("email_canary_probes")
      .update({
        send_status: "failed",
        send_error: result.error ?? null,
        alarm_raised_at: now.toISOString(),
      })
      .eq("id", token);

    await raiseAlarm(
      supabase,
      "delivery_canary_failed",
      `Delivery canary probe could not be sent at all: ${result.error}`,
      { probe_id: token, error: result.error },
    );
    return { sent: false, reason: result.error };
  }

  return { sent: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, readServiceRoleKey());
  const now = new Date();

  try {
    const alarmed = await alarmOverdueProbes(supabase, now);
    const sendResult = await maybeSendProbe(supabase, now);

    await logRun(supabase, JOB_NAME, "success", Date.now() - startedAt, null, {
      overdue_alarmed: alarmed,
      probe_sent: sendResult.sent,
      ...(sendResult.reason ? { skip_reason: sendResult.reason } : {}),
    });

    return json({ success: true, overdue_alarmed: alarmed, probe_sent: sendResult.sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${JOB_NAME}]`, message);
    await logRun(supabase, JOB_NAME, "failure", Date.now() - startedAt, message, {});
    return json({ success: false, error: message }, 500);
  }
});
