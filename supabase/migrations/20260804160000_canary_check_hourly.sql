-- ============================================================================
-- Slow the canary's check cadence from every 15 minutes to hourly, per the
-- user's explicit preference (simplicity over faster detection).
--
-- Tradeoff, stated for the record since it's asymmetric: a SYNCHRONOUS send
-- failure (bad credentials, server down) is still caught immediately either
-- way -- that happens inside the same invocation that attempts the send, not
-- on the check cadence. What slows down is detecting the specific failure
-- mode that motivated building this at all: Byethost accepting a message and
-- silently discarding it, with no error at send time. That's only caught by
-- the overdue-probe sweep, so its worst-case detection latency moves from
-- roughly grace-period-plus-15-minutes to grace-period-plus-up-to-an-hour.
--
-- Not yet in production either way: this job has never been toggled on
-- (cron.job has no 'email-canary-check' row as of this migration), so there
-- is no live schedule being changed under anyone, only the definition a
-- future toggle-on will use.
--
-- Rollback: re-apply 20260804150000's schedule ('*/15 * * * *') for this
-- branch.
-- ============================================================================

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
    -- Was */15 * * * * — see this migration's header for the tradeoff.
    v_schedule := '0 * * * *';
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
