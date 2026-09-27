-- Second self-test: does the alarm email get through now?
--
-- The first attempt (20260926060000) proved the path fires and proved the
-- email was rejected by MailChannels on content: 550 5.7.1 [CS] Message
-- blocked. The subject has since been shortened to a fixed phrase with no
-- machine output in it. Whether that satisfies the filter is a question only
-- a real send can answer — the filter is a third party and its rules are not
-- published.
--
-- Same shape as before: a clearly-named fake job, one sweep, failures
-- removed. The previous alarm was for a different job name, so the 3-day
-- re-alarm cooldown does not suppress this one.

insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
select
  'alarm-email-selftest-2',
  'failure',
  1,
  0,
  'Second deliberate test of the alarm email, after the first was spam-blocked. Nothing is broken.',
  jsonb_build_object('selftest', true)
from generate_series(1, 3) as g(i);

select public.admin_raise_alarms_for_failing_jobs();

delete from public.job_run_logs where job_name = 'alarm-email-selftest-2';
