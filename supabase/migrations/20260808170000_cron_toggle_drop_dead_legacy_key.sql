-- ============================================================================
-- Removes the dead legacy anon JWT from admin_toggle_cron_job.
--
-- WHY THIS IS URGENT RATHER THAN TIDY:
--
-- The legacy anon/service_role key pair was disabled in the Supabase dashboard
-- on 2026-08-08, completing the migration to publishable/secret keys (see
-- docs/plans/implementation_plan_api_key_migration_2026-08-01.md — this is that
-- plan's Phase 6, which it flagged as "must land before outreach is
-- re-enabled").
--
-- admin_toggle_cron_job still hardcoded that now-dead key in v_anon and passed
-- it as the Bearer token for four of its five jobs. Verified dead, not assumed:
--
--   curl .../rest/v1/public_business_listings -H "apikey: <legacy anon>"
--     -> HTTP 401
--
-- Nothing is broken at this moment because the only scheduled job
-- (prune-internal-job-logs-daily) calls a SQL function directly and carries no
-- key at all. The damage is latent: the next time an admin flips a switch in
-- Settings -> Background Jobs, cron.schedule() succeeds, the row appears, the
-- toggle reports success — and every firing thereafter POSTs a dead token,
-- gets 401, and does nothing. Silent, indefinite, and indistinguishable in the
-- UI from working.
--
-- That is the second occurrence of this exact failure in this project. The
-- first is already in docs/bugs.md ("Admin cron toggle pointed two jobs at the
-- dead project — enabling returned success; the jobs could never actually
-- run", 2026-07-25). Same shape, different credential.
--
-- The sharpest case is email-canary-check: that job exists to detect silently
-- failing outbound email. Scheduled with a dead token it would itself fail
-- silently — the detector for silent failure, failing silently.
--
-- THE FIX IS TO REMOVE A CREDENTIAL, NOT REPLACE ONE:
--
-- send-nurture-emails, send-outreach-drip and email-canary are all declared
-- `verify_jwt = false` in supabase/config.toml, so the platform never inspects
-- their Authorization header — they run their own authorization internally.
-- The header was doing nothing for them even while the key was alive. They get
-- no Authorization header at all now: fewer credentials embedded in database
-- objects, and nothing further to update the next time keys rotate.
--
-- publish-scheduled is the one exception. It has no config.toml entry, so it
-- defaults to `verify_jwt = true` and does need a credential. It gets the new
-- publishable key — safe to embed (it is the browser-facing key, already
-- shipped in every page of the site) and a like-for-like replacement for what
-- the anon JWT was doing. Two caveats stated rather than hidden: this project's
-- function list shows publish-scheduled is NOT currently deployed, so this path
-- cannot be verified live today and scheduling that job would 404 regardless of
-- credential; and if the platform's verify_jwt gate rejects a non-JWT
-- publishable key, this needs revisiting when the function is actually
-- deployed. Neither caveat is a reason to leave a known-dead key in place.
--
-- Deploy state is deliberately NOT encoded here (no "refuse to schedule
-- undeployed jobs" branch). Which functions are deployed changes without any
-- git trace and would make this migration stale within hours — the same trap
-- documented in docs/knowledge.md, "Deployment state is invisible to git".
-- Reporting undeployed-but-scheduled belongs in the admin UI, which pings the
-- functions and can see current reality.
--
-- Everything else — schedules, job names, the is_admin() gate, the unschedule
-- path, the return shape — is byte-identical to the previous definition.
--
-- Rollback: re-run 20260804160000_canary_check_hourly.sql, which contains the
-- previous definition of this function. Note that doing so restores the dead
-- key and reintroduces the silent-failure behaviour above.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_toggle_cron_job(p_jobname text, p_enable boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_url text;
  v_schedule text;
  v_command text;
  v_existing bigint;
  -- The browser-facing publishable key. Only publish-scheduled needs it
  -- (verify_jwt = true); every other HTTP job below sends no credential.
  v_publishable text := 'sb_publishable_Vno3bg7_DVgLECuwU6hLxA_iFNiaNpl';
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

  IF p_jobname = 'publish-scheduled-posts' THEN
    -- The only job carrying a credential: no config.toml entry, so the
    -- platform's verify_jwt gate is on for this one.
    v_schedule := '*/15 * * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/publish-scheduled';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json','Authorization','Bearer '||v_publishable)::text,
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
      json_build_object('Content-Type','application/json')::text,
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
      json_build_object('Content-Type','application/json')::text,
      '{}'::text
    );
  ELSIF p_jobname = 'prune-internal-job-logs-daily' THEN
    -- Direct SQL call, no HTTP and no credential — this job was unaffected by
    -- the legacy key being disabled, and stays as it was.
    v_schedule := '17 3 * * *';
    v_command := 'SELECT public.admin_prune_internal_job_logs();';
  ELSIF p_jobname = 'email-canary-check' THEN
    -- Hourly, not */15 — see 20260804160000 for that tradeoff.
    v_schedule := '0 * * * *';
    v_url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/email-canary';
    v_command := format(
      $cmd$ SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := %L::jsonb
      ) AS request_id; $cmd$,
      v_url,
      json_build_object('Content-Type','application/json')::text,
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
$function$;
