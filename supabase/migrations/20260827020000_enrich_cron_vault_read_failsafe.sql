-- Make the scheduled enrichment trigger fail visibly rather than silently.
--
-- 20260827010000 handles a *missing* Vault secret by logging a job_run_logs
-- row. It does not handle the vault read itself raising — no permission on
-- vault.decrypted_secrets, or the view not exposing the columns this reads.
-- In that case the exception aborts the whole function, including the insert
-- meant to record it, and the only trace is cron.job_run_details, which
-- nothing in the admin UI displays. The job would look like it had simply
-- never run: the same indistinguishable-from-dormant state that let enrichment
-- sit idle from 2026-08-20.
--
-- The read is now guarded, and every way it can fail lands in job_run_logs
-- with the reason attached.

create or replace function public.run_enrich_business_email()
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text;
  v_vault_error text;
  v_reason text;
  v_message text;
  v_request_id bigint;
begin
  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'supabase_secret_key';
  exception when others then
    v_key := null;
    v_vault_error := sqlerrm;
  end;

  if v_key is null or btrim(v_key) = '' then
    if v_vault_error is not null then
      v_reason := 'vault_read_failed';
      v_message := 'Scheduled enrichment could not start: reading the Vault secret failed ('
        || v_vault_error || ').';
    else
      v_reason := 'missing_vault_secret';
      v_message := 'Scheduled enrichment could not start: no Vault secret named '
        || '"supabase_secret_key". Add the project''s secret (service role) API key under '
        || 'Project Settings -> Vault, named exactly supabase_secret_key. The '
        || 'enrich-business-email function requires a privileged caller and the anon key is '
        || 'rejected by design.';
    end if;

    insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
    values (
      'enrich-business-email',
      'failure',
      1,
      0,
      v_message,
      jsonb_build_object('trigger', 'cron', 'reason', v_reason)
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

  -- net.http_post queues the request and returns immediately; its default
  -- 5s response timeout does not stop the edge function, which runs 60–80s for
  -- a batch of 20. The run's real outcome is the row that function writes to
  -- job_run_logs itself, exactly as for send-outreach-drip-daily.
  return v_request_id;
end;
$fn$;

revoke all on function public.run_enrich_business_email() from public;
revoke all on function public.run_enrich_business_email() from anon, authenticated;
