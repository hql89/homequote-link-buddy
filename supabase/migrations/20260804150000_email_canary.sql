-- ============================================================================
-- email_canary_probes — proof that outbound email is ACTUALLY arriving.
--
-- Every other delivery signal this project has is either a stale human
-- assertion (delivery_verified_at, entered once and good for 14 days) or
-- dependent on the n8n inbound bridge, which has never delivered a single
-- message (select count(*) from inbound_emails = 0). The canary needs
-- neither: it sends a probe with a random token, and a SEPARATE watcher
-- (an n8n Gmail API trigger — not IMAP, and not this project's dead bridge)
-- posts the token back on receipt. Possession of the token IS proof of
-- delivery, so the confirm endpoint needs no other auth.
--
-- Ported from a sibling project (Mivos.ai), corrected for a wrong assumption
-- caught in review: their confirm leg is a Gmail API trigger, not IMAP, so
-- the probe destination doesn't have to be a mailbox on the sending domain
-- at all. It must, however, never be an address the outreach drip could
-- itself mail — using admin_settings.smtp_config.adminNotificationEmail
-- satisfies that structurally, since that value is never a business's email.
--
-- `id` doubles as the token — no separate token column, since a UUID primary
-- key already has the entropy a proof-of-receipt token needs.
--
-- Rollback: DROP TABLE public.email_canary_probes;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_canary_probes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  send_status   text NOT NULL CHECK (send_status IN ('sent', 'failed')),
  send_error    text,
  confirmed_at  timestamptz,
  alarm_raised_at timestamptz
);

COMMENT ON TABLE public.email_canary_probes IS
  'One row per delivery-canary probe. id doubles as the proof-of-receipt token embedded in the probe subject. confirmed_at is set by confirm-canary when the token is posted back; alarm_raised_at is set once, the first time a probe is found overdue, so a persistent outage does not re-alarm on the same row every check.';

CREATE INDEX IF NOT EXISTS email_canary_probes_sent_at_idx
  ON public.email_canary_probes (sent_at DESC);

-- The two queries email-canary actually runs: "am I overdue?" and "when did
-- I last send?" — both scoped to unconfirmed rows.
CREATE INDEX IF NOT EXISTS email_canary_probes_pending_idx
  ON public.email_canary_probes (sent_at)
  WHERE confirmed_at IS NULL;

ALTER TABLE public.email_canary_probes ENABLE ROW LEVEL SECURITY;

-- Admin read only. All writes happen under the service role from
-- email-canary and confirm-canary, so no INSERT/UPDATE policy is granted to
-- anyone — matches email_send_log and data_audit_log.
DROP POLICY IF EXISTS "Admins can read canary probes" ON public.email_canary_probes;
CREATE POLICY "Admins can read canary probes"
  ON public.email_canary_probes
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT SELECT ON public.email_canary_probes TO authenticated;

-- ============================================================================
-- Extend admin_toggle_cron_job with 'email-canary-check'.
--
-- Scheduled every 15 minutes rather than hourly: the probe cadence itself is
-- governed by shouldSendNewProbe() inside the function (hourly, by default),
-- but the OVERDUE CHECK needs to run more often than the 20-minute grace
-- period or detection latency stacks on top of it. Checking every 15 minutes
-- keeps worst-case detection at roughly grace + 15 minutes, not grace + the
-- probe interval.
--
-- Uses the same current-project anon key literal the other branches already
-- use (see 20260725150000) — this migration does not attempt the pg_cron
-- forward-migration to the new publishable key, which is separately tracked
-- in docs/plans/implementation_plan_api_key_migration_2026-08-01.md and only
-- actually matters once send-outreach-drip-daily is re-enabled; the canary
-- carries the same latent dependency and should be swept up in that same fix
-- rather than diverge from its siblings here.
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
    v_schedule := '*/15 * * * *';
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
