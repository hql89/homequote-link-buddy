-- ============================================================================
-- Slow the delivery canary from hourly to once a day, at the user's explicit
-- request (2026-08-24): "can we change the canary thing to once a day, i
-- don't need it to be hourly."
--
-- Runs at 14:00 UTC (7am PDT), one hour ahead of send-outreach-drip-daily's
-- 15:00 UTC, so a delivery problem shows up on the Overview before the day's
-- real outreach goes out rather than after.
--
-- Tradeoff, stated plainly because it is asymmetric: a SYNCHRONOUS send
-- failure (SMTP timeout, bad credentials, server down) is still caught the
-- instant it happens — that is detected inside the invocation attempting the
-- send, not on the check cadence, and it is what every canary failure logged
-- so far has actually been. What slows is the failure mode that motivated
-- building this: Byethost accepting a message and silently discarding it,
-- which only the overdue-probe sweep catches. Its worst-case detection
-- latency moves from grace-period-plus-up-to-an-hour to grace-period-plus-
-- up-to-a-day.
--
-- Two changes, both required. Changing only the live cron row would work
-- until someone toggled the job off and on from Admin -> Settings, at which
-- point admin_toggle_cron_job would helpfully re-create it hourly again.
--   1. Reschedule the live 'email-canary-check' job.
--   2. Update that same jobname's branch inside admin_toggle_cron_job so a
--      future toggle-on reproduces the daily schedule, not the old hourly
--      one.
-- Everything else in the function is carried over byte-for-byte from
-- 20260804160000; only the email-canary-check schedule line differs.
--
-- The companion change lives in the function code, not here: PROBE_INTERVAL_
-- MINUTES in _shared/canary.ts moves 60 -> 1380 so the send gate agrees with
-- the new cadence. 23 hours rather than 24 on purpose — the probe sends a few
-- seconds after cron fires, so a flat 1440 would measure ~23h59m on the next
-- day's run and skip it forever. Deploy the function alongside this migration.
--
-- Rollback: re-apply 20260804160000_canary_check_hourly.sql (restores both
-- the '0 * * * *' branch and, after a toggle off/on from the Background Jobs
-- page, the live hourly schedule), and revert PROBE_INTERVAL_MINUTES to 60.
-- To stop the probes entirely instead: SELECT cron.unschedule('email-canary-
-- check');
-- ============================================================================

SELECT cron.schedule(
  'email-canary-check',
  '0 14 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/email-canary',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxycWRicHBoYWxscWVocGRxYWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDY3MzUsImV4cCI6MjEwMDAyMjczNX0.y6t45RrA6pQXLMczkNpFn4Ci6Z7M5zrpTnKhxa2q_04'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $cmd$
);

CREATE OR REPLACE FUNCTION public.admin_toggle_cron_job(p_jobname text, p_enable boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url text;
  v_anon text;
  v_schedule text;
  v_command text;
  v_existing bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT p_enable THEN
    SELECT jobid INTO v_existing FROM cron.job WHERE jobname = p_jobname;
    IF v_existing IS NOT NULL THEN
      PERFORM cron.unschedule(p_jobname);
    END IF;
    RETURN jsonb_build_object('jobname', p_jobname, 'active', false);
  END IF;

  v_anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxycWRicHBoYWxscWVocGRxYWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDY3MzUsImV4cCI6MjEwMDAyMjczNX0.y6t45RrA6pQXLMczkNpFn4Ci6Z7M5zrpTnKhxa2q_04';

  IF p_jobname = 'publish-scheduled-posts' THEN
    v_schedule := '*/15 * * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/publish-scheduled';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::text,
      '{}'::text
    );
  ELSIF p_jobname = 'send-nurture-emails-hourly' THEN
    v_schedule := '0 * * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/send-nurture-emails';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::text,
      '{}'::text
    );
  ELSIF p_jobname = 'send-outreach-drip-daily' THEN
    v_schedule := '0 15 * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/send-outreach-drip';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::text,
      '{}'::text
    );
  ELSIF p_jobname = 'prune-internal-job-logs-daily' THEN
    v_schedule := '17 3 * * *';
    v_command := 'SELECT public.admin_prune_internal_job_logs();';
  ELSIF p_jobname = 'email-canary-check' THEN
    -- Was */15, then 0 * * * * — now daily, an hour before the outreach
    -- drip. See this migration's header for the detection-latency tradeoff.
    v_schedule := '0 14 * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/email-canary';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon)::text,
      '{}'::text
    );
  ELSE
    RAISE EXCEPTION 'Unknown job: %', p_jobname;
  END IF;

  SELECT jobid INTO v_existing FROM cron.job WHERE jobname = p_jobname;
  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(p_jobname);
  END IF;

  PERFORM cron.schedule(p_jobname, v_schedule, v_command);

  RETURN jsonb_build_object('jobname', p_jobname, 'active', true, 'schedule', v_schedule);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_toggle_cron_job(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_cron_job(text, boolean) TO authenticated;
