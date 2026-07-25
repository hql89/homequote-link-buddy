-- ============================================================================
-- admin_toggle_cron_job still pointed 'publish-scheduled-posts' and
-- 'send-nurture-emails-hourly' at project ref cjdhbiuhzrpruqbbnnqz with an
-- anon key scoped to it. That project is dead -- this codebase has been on
-- lrqdbpphallqehpdqalr since the tree-service pivot. Any admin who enabled
-- either job via the System Status page would have gotten a 200 from
-- cron.schedule() with no indication the HTTP call inside it could only ever
-- fail. (The anon key itself is a publishable key, safe to store in a
-- migration -- same as it being shipped in every browser bundle.)
--
-- This migration only fixes the bug. It does not enable pg_cron and does not
-- schedule anything -- every job stays exactly as inert/active as it already
-- was. send-outreach-drip in particular (the directory cold-email engine) is
-- deliberately left unscheduled: turning it on means it will autonomously
-- email real businesses once any are ingested, with no per-send review, and
-- that decision belongs to the business owner, not this migration. Enable it
-- from the System Status page ('send-outreach-drip-daily', now a recognised
-- job name below) when ready.
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

  -- Current project's anon key (publishable by design -- see header).
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
    v_schedule := '0 15 * * *'; -- 15:00 UTC ≈ 8am Pacific, a reasonable send time
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

-- pg_cron itself is intentionally NOT enabled here, and nothing is scheduled.
-- 'send-outreach-drip-daily' is only added as a name this function recognises;
-- calling admin_toggle_cron_job() for any job (from the System Status page)
-- will fail until pg_cron is installed, exactly as it already would have
-- before this migration -- that part of the behavior is unchanged.
