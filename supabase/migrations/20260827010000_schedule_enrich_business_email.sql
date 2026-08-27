-- Put email enrichment on a daily schedule, and raise its batch size.
--
-- enrich-business-email has been enabled, keyed, and unscheduled since it was
-- written: cron.job holds only email-canary-check, prune-internal-job-logs-daily
-- and send-outreach-drip-daily. It runs when someone clicks the button on
-- Admin -> Enrichment, which last happened 2026-08-20, leaving 472 published
-- businesses un-enriched while the drip ran its pool down to six.
--
-- ── Why this needs a Vault secret, when the other two cron'd functions don't ─
--
-- email-canary and send-outreach-drip are deployed verify_jwt: false and check
-- nothing, so their cron entries can post with no usable credential (the anon
-- JWT in email-canary-check's header is decorative). enrich-business-email is
-- deployed verify_jwt: true AND gates on isPrivilegedCaller, which authorises
-- by trying to read admin_settings as the caller. That table's only policy is
-- `authenticated USING is_admin()`, so an anon key is filtered to zero rows and
-- denied. Only the secret key (which bypasses RLS) or a logged-in admin's JWT
-- passes, and an admin JWT expires hourly, so cron cannot use one.
--
-- Making the function public instead is not an option worth taking: its batch
-- size is per-invocation, not per-day, so an unauthenticated caller could spend
-- Perplexity credits in a loop.
--
-- The key therefore has to be read at run time from somewhere that is not this
-- file. Vault is that place. Nothing secret is committed here.
--
-- ── If the secret is absent ─────────────────────────────────────────────────
--
-- The job is scheduled active regardless, and logs an explicit failure row
-- naming the missing secret. That row surfaces on Admin -> Enrichment and
-- Background Jobs. A silently disabled job would be indistinguishable from a
-- working one that found nothing — the exact confusion that let enrichment sit
-- dormant for a week. job_run_logs failures do not raise alarms or send email
-- (admin_recent_alarms reads only job_name = 'alarm'), so this is visible
-- without being noisy.

-- ── Batch size ──────────────────────────────────────────────────────────────
-- 5 -> 20. Not a guess: four real runs of exactly 20 rows took 58–78s wall
-- clock (~3–4s/row) per job_run_logs, comfortably inside the edge function
-- limit, and 20 is the largest batch this function is known to have completed.
-- At the observed ~31% hit rate (64 enriched -> 20 usable emails) that is ~6
-- new emails a day against a drip that spends 5, and clears the 472 backlog in
-- roughly 24 days. MAX_DAILY_LIMIT in the function caps this at 100 anyway.
update public.admin_settings
set setting_value = setting_value || '{"daily_limit": 20}'::jsonb,
    updated_at = now()
where setting_key = 'enrichment_config';

-- ── Trigger ─────────────────────────────────────────────────────────────────
create or replace function public.run_enrich_business_email()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text;
  v_request_id bigint;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'supabase_secret_key';

  if v_key is null or btrim(v_key) = '' then
    insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
    values (
      'enrich-business-email',
      'failure',
      1,
      0,
      'Scheduled enrichment could not start: no Vault secret named "supabase_secret_key". '
        || 'Add the project''s secret (service role) API key under Project Settings -> Vault, '
        || 'named exactly supabase_secret_key. The enrich-business-email function requires a '
        || 'privileged caller and the anon key is rejected by design.',
      jsonb_build_object('trigger', 'cron', 'reason', 'missing_vault_secret')
    );
    return null;
  end if;

  select net.http_post(
    url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/enrich-business-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  ) into v_request_id;

  return v_request_id;
end;
$fn$;

-- SECURITY DEFINER and it reads a credential: reachable only by the cron owner.
revoke all on function public.run_enrich_business_email() from public;
revoke all on function public.run_enrich_business_email() from anon, authenticated;

-- ── Schedule ────────────────────────────────────────────────────────────────
-- 13:00 UTC, two hours ahead of send-outreach-drip-daily at 15:00 UTC, so a
-- day's newly found addresses are available to that same day's send rather
-- than waiting for the next one.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'enrich-business-email-daily') then
    perform cron.unschedule('enrich-business-email-daily');
  end if;
end
$do$;

select cron.schedule(
  'enrich-business-email-daily',
  '0 13 * * *',
  $cron$select public.run_enrich_business_email();$cron$
);

-- Rollback:
--   select cron.unschedule('enrich-business-email-daily');
--   drop function if exists public.run_enrich_business_email();
--   update public.admin_settings
--     set setting_value = setting_value || '{"daily_limit": 5}'::jsonb
--     where setting_key = 'enrichment_config';
-- The enrichment_config.enabled flag remains an independent kill switch that
-- needs no migration and no deploy.
