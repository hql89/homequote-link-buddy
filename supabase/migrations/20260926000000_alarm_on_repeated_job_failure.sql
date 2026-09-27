-- Escalate a job that keeps failing into something the admin banner shows.
--
-- enrich-business-email failed 29 mornings in a row with a clear, actionable
-- message and nobody saw it, because AlarmBanner only reads job_name='alarm'
-- and an ordinary job failure never becomes one however often it repeats.
-- Outreach sent nothing for 28 days as a result.
--
-- A sweep rather than a change to logRun(): the enrichment failure row is
-- written directly in SQL by run_enrich_business_email, not through logRun, so
-- escalating inside that helper would miss the exact case that prompted this.
-- A sweep also covers any job, including ones yet to be written.

create or replace function public.admin_raise_alarms_for_failing_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Three consecutive failures. For a daily job that is three days: soon
  -- enough to matter, past the point where one transient network blip reads
  -- as a pattern.
  FAILURE_THRESHOLD constant integer := 3;
  -- A stuck job must not produce a fresh banner every morning. Daily noise is
  -- how the original message came to be ignored; re-alarming turns the banner
  -- into wallpaper and costs more than it gains.
  RE_ALARM_AFTER constant interval := interval '3 days';
  LOOKBACK constant interval := interval '30 days';
  v_raised integer := 0;
  r record;
begin
  for r in
    with recent as (
      select job_name, status, created_at,
             row_number() over (partition by job_name order by created_at desc) as rn
      from public.job_run_logs
      -- Alarms are themselves written as job_name='alarm' with status
      -- 'failure'. Including them would have this function alarm about its
      -- own alarms, forever.
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
      -- Rows newer than the job's most recent success are its current losing
      -- streak. A job with no success at all in the window has every row
      -- counted, which is the correct reading of "it has never worked".
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
       and not exists (
         select 1
           from public.job_run_logs a
          where a.job_name = 'alarm'
            and a.metadata->>'alarm_kind' = 'job_failing_repeatedly'
            and a.metadata->>'job' = s.job_name
            and a.created_at > now() - RE_ALARM_AFTER
       )
  loop
    insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
    values (
      'alarm',
      'failure',
      1,
      null,
      format(
        '%s has failed %s runs in a row, most recently %s. Latest error: %s',
        r.job_name,
        r.failures,
        to_char(r.last_failure_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
        coalesce(nullif(btrim(r.last_error), ''), '(none recorded)')
      ),
      jsonb_build_object(
        'alarm_kind', 'job_failing_repeatedly',
        'job', r.job_name,
        'consecutive_failures', r.failures,
        'last_failure_at', r.last_failure_at
      )
    );
    v_raised := v_raised + 1;
  end loop;

  return v_raised;
end;
$fn$;

revoke all on function public.admin_raise_alarms_for_failing_jobs() from public;
revoke all on function public.admin_raise_alarms_for_failing_jobs() from anon, authenticated;

-- 16:00 UTC — after the canary (14:00), enrichment (13:00) and the drip
-- (15:00), so a morning's outcome is judged the same day rather than the next.
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'alarm-failing-jobs-daily') then
    perform cron.unschedule('alarm-failing-jobs-daily');
  end if;
end
$do$;

select cron.schedule(
  'alarm-failing-jobs-daily',
  '0 16 * * *',
  $cron$select public.admin_raise_alarms_for_failing_jobs();$cron$
);

-- Rollback:
--   select cron.unschedule('alarm-failing-jobs-daily');
--   drop function if exists public.admin_raise_alarms_for_failing_jobs();
