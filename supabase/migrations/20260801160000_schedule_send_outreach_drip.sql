-- ============================================================================
-- Turns on the directory cold-outreach engine (send-outreach-drip), left
-- deliberately unscheduled in 20260725150000 pending an explicit decision
-- from the business owner. User confirmed 2026-08-01: enable it.
--
-- Runs daily at 15:00 UTC (~8am Pacific). Each run sends Email 1 (license
-- verification) to any non-paused business with an email on file that hasn't
-- been emailed yet, then Email 2 (preview + claim link) to anyone whose
-- Email 1 was sent 3+ days ago and who hasn't claimed their listing — see
-- supabase/functions/send-outreach-drip/index.ts. Capped at 50 sends per
-- category per run.
--
-- At the time this was enabled, 0 businesses qualified: of 536 total, only
-- 23 have an email address, and all 23 have outreach_paused = true. So this
-- does not send anything immediately -- it only takes effect once a business
-- is un-paused or newly enriched with an email while not paused.
--
-- Rollback: SELECT cron.unschedule('send-outreach-drip-daily');
-- (equivalent to admin_toggle_cron_job('send-outreach-drip-daily', false)
-- from the System Status page).
-- ============================================================================

SELECT cron.schedule(
  'send-outreach-drip-daily',
  '0 15 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/send-outreach-drip',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxycWRicHBoYWxscWVocGRxYWxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDY3MzUsImV4cCI6MjEwMDAyMjczNX0.y6t45RrA6pQXLMczkNpFn4Ci6Z7M5zrpTnKhxa2q_04'
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $cmd$
);
