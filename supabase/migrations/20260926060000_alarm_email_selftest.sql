-- Prove the alarm email actually sends, once.
--
-- The emailing added on 2026-09-26 has never fired: the day's sweep had
-- already run before it was deployed, and `enrich-business-email` — the only
-- job with a failing streak — is now succeeding and is inside its 3-day
-- re-alarm cooldown anyway. An alert path nobody has ever seen work is a
-- guess, and this one exists precisely because a real failure went unseen
-- for 30 days.
--
-- So: a deliberately-failing job with an obvious name, one sweep, then the
-- fake failures are removed again. The alarm row it produces is left in
-- place on purpose — that is the artifact to look at, in the banner and in
-- the inbox. Removing the failures stops it re-alarming in three days.
--
-- Nothing real is touched. No business, no outreach, no schedule.

insert into public.job_run_logs (job_name, status, attempts, duration_ms, error_message, metadata)
select
  'alarm-email-selftest',
  'failure',
  1,
  0,
  'Deliberate test of the alarm email path. Nothing is broken — this job does not exist '
    || 'outside this check, and its failure rows are deleted in the same migration.',
  jsonb_build_object('selftest', true)
from generate_series(1, 3) as g(i);

-- Raises the alarm and, inside the same function, queues the email.
select public.admin_raise_alarms_for_failing_jobs();

-- The fake failures have served their purpose. The alarm row they produced
-- stays.
delete from public.job_run_logs
 where job_name = 'alarm-email-selftest';

-- Rollback: delete the alarm row too —
--   delete from public.job_run_logs
--    where job_name = 'alarm' and metadata->>'job' = 'alarm-email-selftest';
