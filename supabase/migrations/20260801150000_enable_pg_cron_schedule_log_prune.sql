-- ============================================================================
-- pg_cron was never actually enabled on this project, so every job the admin
-- panel's toggle claims to schedule (publish-scheduled-posts,
-- send-nurture-emails-hourly, send-outreach-drip-daily,
-- prune-internal-job-logs-daily) has silently done nothing: cron.schedule()
-- doesn't exist without the extension, and admin_toggle_cron_job() would just
-- error out if called.
--
-- This migration enables pg_cron and turns on exactly one job:
-- prune-internal-job-logs-daily, which runs admin_prune_internal_job_logs()
-- (added in 20260429151254) at 03:17 UTC daily. That function only deletes
-- internal log rows this app itself wrote (cron.job_run_details older than 7
-- days, net._http_response older than 1 day, public.job_run_logs older than
-- 30 days) -- never leads, businesses, or any customer-facing data.
--
-- Deliberately NOT enabled here: publish-scheduled-posts,
-- send-nurture-emails-hourly, send-outreach-drip-daily. Those call live edge
-- functions with real side effects (publishing content, emailing leads,
-- cold-emailing businesses) and should stay an explicit choice from the
-- System Status page, not something a migration turns on.
--
-- Rollback: SELECT cron.unschedule('prune-internal-job-logs-daily');
-- (equivalent to calling admin_toggle_cron_job('prune-internal-job-logs-daily', false)
-- from the admin panel). Dropping the pg_cron extension is not necessary to
-- undo this and is left alone to avoid disturbing anything else that may
-- come to depend on it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

GRANT USAGE ON SCHEMA cron TO postgres;

SELECT cron.schedule(
  'prune-internal-job-logs-daily',
  '17 3 * * *',
  $cmd$SELECT public.admin_prune_internal_job_logs();$cmd$
);
