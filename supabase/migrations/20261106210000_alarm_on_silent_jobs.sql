-- ============================================================================
-- Alarm when a scheduled job goes SILENT, not just when it fails.
--
-- The gap this closes, found 2026-11-06 with the failure live:
-- `email-canary` — the daily probe whose entire job is to prove outbound mail
-- still arrives — last wrote a row on 2026-11-02. Four days silent, and
-- nothing anywhere noticed. pg_cron fired it all eight times in the window
-- (cron.job_run_details: 8 succeeded, including today at 14:00), so the
-- schedule is fine; the function is not completing far enough to log. 26 runs
-- in 30 days against a daily schedule.
--
-- `admin_raise_alarms_for_failing_jobs` cannot catch this and never could. It
-- counts `status = 'failure'` rows. A job that stops running writes no rows at
-- all, so there is nothing to count — silence and health look identical to it.
-- Worse, pg_cron reports "succeeded" for the `net.http_post` that *queues* the
-- call, so the cron history also looks healthy. Every indicator agreed the
-- system was fine while the one check that proves mail works was dead.
--
-- This matters beyond the canary: the whole alarm apparatus is built on jobs
-- writing rows. A job that dies quietly disables its own alarms.
--
-- ## Why a table rather than a CASE in the function
--
-- `admin_toggle_cron_job` already demonstrates the trap of a schedule hidden
-- inside a function body: it recreates jobs from hardcoded values, so a
-- schedule changed by a later migration is silently reverted on the next
-- toggle. Putting expectations in a table keeps them visible, queryable and
-- editable without a function rewrite, and lets a job be muted without
-- deleting its history.
--
-- Expectations are NOT derived from `cron.job.schedule`: parsing cron
-- expressions in SQL is error-prone, and the logged `job_name`
-- ('email-canary') is deliberately not the cron jobname
-- ('email-canary-check'), so the two cannot be joined reliably anyway.
--
-- `max_silence` is generous on purpose — 36 hours for a daily job. A single
-- missed run on a slow day should not page anyone; two in a row is a real
-- signal. False alarms are how an alarm system gets ignored, which is the
-- failure this project has already had with "30 vulnerabilities".
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.admin_raise_alarms_for_silent_jobs();
--   DROP TABLE IF EXISTS public.job_heartbeat_expectations;
--   SELECT cron.unschedule('alarm-silent-jobs-daily');
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.job_heartbeat_expectations (
  job_name     text PRIMARY KEY,
  -- How long this job may go without writing a job_run_logs row before it is
  -- considered silent. Generous by design; see above.
  max_silence  interval NOT NULL,
  -- Mute without losing the row, e.g. for a job deliberately unscheduled.
  is_active    boolean NOT NULL DEFAULT true,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_heartbeat_expectations IS
  'How often each scheduled job is expected to write a job_run_logs row. Read by admin_raise_alarms_for_silent_jobs(). A job absent from this table is never checked for silence — adding a new scheduled job means adding it here too.';

-- Seeded from the three jobs that actually logged runs in the 30 days before
-- this migration, each on a daily schedule (avg gap 24.0h for all three).
INSERT INTO public.job_heartbeat_expectations (job_name, max_silence, note) VALUES
  ('email-canary', interval '36 hours',
   'Daily 14:00 UTC. The probe that proves outbound mail still arrives — if this is silent, every other delivery signal is unverified. Silent 2026-11-02 to 2026-11-06, which is why this check exists.'),
  ('enrich-business-email', interval '36 hours',
   'Daily 13:00 UTC. Currently failing every run for a missing Vault secret (ENH-009) — that is a separate alarm; this one only fires if it stops running at all.'),
  ('prune-internal-job-logs-daily', interval '36 hours',
   'Daily 03:17 UTC. Housekeeping; low stakes, included so the table matches the real schedule rather than only the interesting jobs.')
ON CONFLICT (job_name) DO NOTHING;

-- No RLS policy and no grant to anon/authenticated: this table is read only by
-- the SECURITY DEFINER function below and by an admin via the service role.
ALTER TABLE public.job_heartbeat_expectations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_raise_alarms_for_silent_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  RE_ALARM_AFTER constant interval := interval '3 days';
  v_raised integer := 0;
  v_summary text;
  v_silent_for interval;
  r record;
BEGIN
  FOR r IN
    SELECT e.job_name,
           e.max_silence,
           (SELECT max(l.created_at)
              FROM public.job_run_logs l
             WHERE l.job_name = e.job_name) AS last_run_at
      FROM public.job_heartbeat_expectations e
     WHERE e.is_active
  LOOP
    -- A job that has NEVER logged is not alarmed: it is far more likely to be
    -- a typo in this table, or a job added here before it first runs, than a
    -- real outage. Silence is only meaningful against a known heartbeat.
    CONTINUE WHEN r.last_run_at IS NULL;
    CONTINUE WHEN r.last_run_at > now() - r.max_silence;

    -- Do not re-alarm the same job every day while it stays silent.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.job_run_logs a
       WHERE a.job_name = 'alarm'
         AND a.metadata->>'alarm_kind' = 'job_went_silent'
         AND a.metadata->>'job' = r.job_name
         AND a.created_at > now() - RE_ALARM_AFTER
    );

    v_silent_for := now() - r.last_run_at;

    v_summary := format(
      '%s has not run since %s — silent for %s, and it is expected at least every %s. The job is not failing; it has stopped reporting, which no other alarm can see.',
      r.job_name,
      to_char(r.last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
      (SELECT extract(day from v_silent_for)::int || 'd ' ||
              lpad(extract(hour from v_silent_for)::int::text, 2, '0') || 'h'),
      r.max_silence::text
    );

    INSERT INTO public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
    VALUES (
      'alarm', 'failure', 1, NULL, v_summary,
      jsonb_build_object(
        'alarm_kind', 'job_went_silent',
        'job', r.job_name,
        'last_run_at', r.last_run_at,
        'silent_for_hours', round(extract(epoch from v_silent_for) / 3600.0)
      )
    );

    -- After the insert, same ordering and same reasoning as
    -- admin_raise_alarms_for_failing_jobs: the record is the durable part and
    -- must not depend on the push succeeding. The subject stays short and
    -- human — machine output in a subject gets this domain's mail rejected
    -- 550 5.7.1 by the relay.
    BEGIN
      PERFORM net.http_post(
        url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/notify-admin-email',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'notificationType', 'alarm',
          'alarmData', jsonb_build_object(
            'kind', 'job_went_silent',
            'summary', v_summary,
            'detail', format('Last run %s. Expected at least every %s.',
                             r.last_run_at, r.max_silence)
          )
        )
      );
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Could not queue silent-job alarm for %: %', r.job_name, sqlerrm;
    END;

    v_raised := v_raised + 1;
  END LOOP;

  RETURN v_raised;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_raise_alarms_for_silent_jobs() FROM PUBLIC, anon, authenticated;

-- Runs at 16:30 UTC — half an hour after alarm-failing-jobs-daily (16:00) so
-- the two sweeps do not interleave, and well after the three daily jobs
-- (03:17, 13:00, 14:00) have had their chance to report for the day.
SELECT cron.schedule(
  'alarm-silent-jobs-daily',
  '30 16 * * *',
  $cron$ SELECT public.admin_raise_alarms_for_silent_jobs(); $cron$
);
