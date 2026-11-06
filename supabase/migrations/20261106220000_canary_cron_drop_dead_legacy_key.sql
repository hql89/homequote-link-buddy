-- ============================================================================
-- Re-schedule email-canary-check without the dead legacy token.
--
-- 20260808170000 removed that token from `admin_toggle_cron_job`, and said
-- this would happen, in these words:
--
--   "The sharpest case is email-canary-check: that job exists to detect
--    silently failing outbound email. Scheduled with a dead token it would
--    itself fail silently — the detector for silent failure, failing
--    silently."
--
-- It did. That migration fixed the function that CREATES jobs; the already
-- scheduled `email-canary-check` row was never recreated, so it still carried
-- the legacy JWT in its command. Observed 2026-11-06:
--
--   * job_run_logs 'email-canary': a clean daily success at 14:00 every day
--     through 2026-11-02, then nothing. Not a failure row — nothing.
--   * net._http_response for the 2026-11-06 14:00 firing: HTTP 401,
--     "Legacy API keys are disabled ... disabled on 2026-08-08".
--   * cron.job_run_details: 8 of 8 "succeeded" over the same window, because
--     that only reports whether net.http_post queued the request.
--
-- So the keys were switched off in August and enforcement began around
-- 2026-11-03; the job had been running on borrowed time for three months. For
-- four days the one check that proves outbound mail still arrives was dead,
-- and every indicator read healthy. This is the third occurrence of this
-- shape in the project — see docs/bugs.md, 2026-07-25 (dead project ref) and
-- 20260808170000 (dead anon key).
--
-- ## The fix removes a credential rather than replacing one
--
-- `email-canary` is declared `verify_jwt = false` in supabase/config.toml, so
-- the platform never inspects its Authorization header — the function does its
-- own authorization internally. The header was doing nothing for it even while
-- the key was alive; it was only ever enough to get the request rejected at
-- the gateway once the key died. Dropping it is exactly what 20260808170000
-- did for send-nurture-emails, send-outreach-drip and email-canary inside
-- `admin_toggle_cron_job`, and it is the same reasoning here: fewer
-- credentials embedded in database objects, and nothing to update the next
-- time keys rotate.
--
-- Deliberately NOT the Vault pattern that `run_enrich_business_email()` uses.
-- That function needs a privileged caller and reads `supabase_secret_key` from
-- Vault — a secret that does not exist yet, which is why enrichment has failed
-- 30 runs straight (ENH-009). Routing the canary through the same dependency
-- would make a working check wait on an unrelated missing secret.
--
-- `cron.schedule` with an existing jobname replaces that job in place, so the
-- schedule (14:00 UTC daily, unchanged — once a day is what is wanted) and the
-- jobname survive.
--
-- Rollback — restores the pre-change command, dead token and all, so it is
-- only useful to prove the diagnosis:
--   SELECT cron.schedule('email-canary-check', '0 14 * * *',
--     $$ SELECT net.http_post(
--          url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/email-canary',
--          headers := '{"Content-Type":"application/json","Authorization":"Bearer <legacy>"}'::jsonb,
--          body := '{}'::jsonb) $$);
-- ============================================================================

SELECT cron.schedule(
  'email-canary-check',
  '0 14 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/email-canary',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $cron$
);

-- Belt and braces for the thing that actually hurt: the heartbeat row added in
-- 20261106210000 means that if this job stops reporting again — for this
-- reason or any other — it is alarmed within 36 hours instead of never. That
-- row already exists; this re-states why it matters for this job specifically.
UPDATE public.job_heartbeat_expectations
   SET note = 'Daily 14:00 UTC. The probe that proves outbound mail still arrives — if this is silent, every other delivery signal is unverified. Went silent 2026-11-02 to 2026-11-06 on a dead legacy API key in its own cron command (fixed by 20261106220000), with pg_cron reporting "succeeded" throughout.'
 WHERE job_name = 'email-canary';
