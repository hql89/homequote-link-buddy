-- ============================================================================
-- Turns on the delivery canary's hourly check, at the user's explicit
-- request (2026-08-14): "turn on the canary probe job too."
--
-- What this actually does: sends one email an hour, from admin@homequote-
-- link.com to admin_settings.smtp_config.adminNotificationEmail
-- (dgarcia89@gmail.com) — the operator's own inbox, not any business or
-- lead. Subject "HomeQuoteLink Delivery Probe #<uuid>". Nothing else sends
-- as a result of this; outreach and nurture remain on their own separate,
-- still-unscheduled/untouched jobs.
--
-- Prerequisite already satisfied: the n8n watcher ("HomeQuoteLink Delivery
-- Probe — Confirm", workflow 8o0QBYSlYhvIecJj) was activated first, in the
-- correct order documented in n8n/delivery_canary_workflow.json — reversed,
-- the first hour of probes would all report undelivered.
--
-- Uses the identical schedule and command admin_toggle_cron_job('email-
-- canary-check', true) would produce (see that function's branch in
-- 20260804160000_canary_check_hourly.sql) — applied directly here because
-- that RPC requires an authenticated admin session (auth.uid() via
-- is_admin()), which a migration connection does not have. Calling the RPC
-- from Admin -> Settings -> Background Jobs afterward is idempotent with
-- this: it unschedules and reschedules the same jobname with the same
-- definition.
--
-- Rollback: SELECT cron.unschedule('email-canary-check');
-- (equivalent to admin_toggle_cron_job('email-canary-check', false) from
-- the System Status / Background Jobs page).
-- ============================================================================

SELECT cron.schedule(
  'email-canary-check',
  '0 * * * *',
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
