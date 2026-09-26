-- Email the repeated-failure alarm, not just record it.
--
-- The sweep writes its alarm row directly, so it never passes through
-- _shared/alarm.ts's raiseAlarm and does not get the email that now sends
-- from there. Which makes it the one alarm most likely to matter and least
-- likely to be seen: it fires precisely when something has been quietly
-- broken for days, and until now its only output was a banner on a page
-- nobody had a reason to open. enrich-business-email failed 30 mornings
-- running before anyone noticed.
--
-- notify-admin-email is deployed verify_jwt: false, so pg_net can reach it
-- with no credential — unlike enrich-business-email, this needs no Vault
-- secret and works today.
--
-- Fired per alarm actually raised, so the 3-day re-alarm cooldown already in
-- this function throttles the email too; there is no second rate limit to
-- keep in step.

create or replace function public.admin_raise_alarms_for_failing_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  FAILURE_THRESHOLD constant integer := 3;
  RE_ALARM_AFTER constant interval := interval '3 days';
  LOOKBACK constant interval := interval '30 days';
  STREAK_MUST_BE_WITHIN constant interval := interval '7 days';
  v_raised integer := 0;
  v_summary text;
  r record;
begin
  for r in
    with recent as (
      select job_name, status, created_at,
             row_number() over (partition by job_name order by created_at desc) as rn
      from public.job_run_logs
      where job_name <> 'alarm'
        and created_at > now() - LOOKBACK
    ),
    latest_success as (
      select job_name, min(rn) as rn
      from recent
      where status = 'success'
      group by job_name
    ),
    streak as (
      select rc.job_name,
             count(*) filter (where rc.status = 'failure') as failures,
             max(rc.created_at) as last_failure_at
      from recent rc
      left join latest_success ls on ls.job_name = rc.job_name
      where rc.rn < coalesce(ls.rn, 2147483647)
      group by rc.job_name
    )
    select s.job_name, s.failures, s.last_failure_at,
           (select l.error_message
              from public.job_run_logs l
             where l.job_name = s.job_name and l.status = 'failure'
             order by l.created_at desc
             limit 1) as last_error
      from streak s
     where s.failures >= FAILURE_THRESHOLD
       and s.last_failure_at > now() - STREAK_MUST_BE_WITHIN
       and not exists (
         select 1
           from public.job_run_logs a
          where a.job_name = 'alarm'
            and a.metadata->>'alarm_kind' = 'job_failing_repeatedly'
            and a.metadata->>'job' = s.job_name
            and a.created_at > now() - RE_ALARM_AFTER
       )
  loop
    v_summary := format(
      '%s has failed %s runs in a row, most recently %s. Latest error: %s',
      r.job_name,
      r.failures,
      to_char(r.last_failure_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
      coalesce(nullif(btrim(r.last_error), ''), '(none recorded)')
    );

    insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
    values (
      'alarm', 'failure', 1, null, v_summary,
      jsonb_build_object(
        'alarm_kind', 'job_failing_repeatedly',
        'job', r.job_name,
        'consecutive_failures', r.failures,
        'last_failure_at', r.last_failure_at
      )
    );

    -- After the insert, deliberately. The record is the durable part and must
    -- not depend on the push; a failed send leaves the alarm intact on the
    -- banner. pg_net queues the request and returns immediately, so a slow or
    -- unreachable mail path cannot stall the sweep either.
    begin
      perform net.http_post(
        url := 'https://lrqdbpphallqehpdqalr.supabase.co/functions/v1/notify-admin-email',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'notificationType', 'alarm',
          'alarmData', jsonb_build_object(
            'kind', 'job_failing_repeatedly',
            'summary', v_summary,
            'detail', format('%s consecutive failures. Job: %s.', r.failures, r.job_name)
          )
        )
      );
    exception when others then
      raise warning 'Could not queue alarm email for %: %', r.job_name, sqlerrm;
    end;

    v_raised := v_raised + 1;
  end loop;

  return v_raised;
end;
$fn$;

revoke all on function public.admin_raise_alarms_for_failing_jobs() from public;
revoke all on function public.admin_raise_alarms_for_failing_jobs() from anon, authenticated;
