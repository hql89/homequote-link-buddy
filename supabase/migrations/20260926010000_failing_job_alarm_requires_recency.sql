-- Don't alarm about a job that stopped running a month ago.
--
-- The first version counted every run newer than a job's most recent success.
-- That is right for a job that runs daily and keeps failing, but wrong for one
-- that is simply dormant: with no success ever recorded, a stale streak stays
-- "current" forever.
--
-- It caught `unsubscribe` on its first read — 3 failures whose most recent was
-- 2026-08-29, 28 days ago. Those are not a broken job at all: `unsubscribe`
-- logs once per HTTP request, and the three rows are bots and mail scanners
-- hitting the link with invalid tokens. Nothing has hit it since. Alarming on
-- that would have taught the banner's first lesson as "this thing cries wolf".
--
-- The fix is recency, not a list of job names to ignore — a hardcoded list
-- rots, and the real property being tested is "is this failing NOW".
--
-- 7 days rather than 3: long enough that a weekly job failing three weeks
-- running still qualifies, short enough to exclude month-old request noise.

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
  -- The streak must still be live. Without this, a job that failed a few
  -- times and then stopped being called looks identical to one failing every
  -- morning.
  STREAK_MUST_BE_WITHIN constant interval := interval '7 days';
  v_raised integer := 0;
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
