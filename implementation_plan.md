# Implementation Plan: Make a failing job visible where someone will see it

## Context

`enrich-business-email` has failed 29 consecutive mornings with a clear, actionable message
("no Vault secret named supabase_secret_key ... add it under Project Settings -> Vault").
Nobody saw it, and outreach has sent nothing for 28 days as a result.

The message was never the problem. Where it landed was.

## Three defects, one theme

### 1. The Enrichment page renders a failed run as nothing at all

`Enrichment.tsx` reads only `metadata` and passes it to `summariseRun`. `summariseEnrichment`
bails with `text: null` when `considered` is absent — which it always is for a run that never
started. The page then renders `{lastRun && ...}`, so the "Last run" line simply disappears.

A page that has failed every day for a month looks identical to one that has never run. That
is the exact false-confidence failure mode this project has a standing rule against, and
`admin_recent_job_runs` already returns `status` and `error_message` — the page throws both
away.

### 2. Nothing escalates a job that keeps failing

`AlarmBanner` only reads `job_name = 'alarm'`. An ordinary job failure never becomes one, no
matter how many times it repeats, so the banner stayed silent for 29 days.

### 3. `outreach_bounce_rate` is missing from the alarm display map

Mine, from the previous change: added to `AlarmKind` in `_shared/alarm.ts` but never to
`TITLES`/`SEVERITY` in `src/lib/alarmDisplay.ts`. If the bounce breaker ever trips, the banner
falls back to the raw developer-facing message as its headline.

The test that exists to prevent exactly this (`alarmDisplay.test.ts`, "covers every kind
currently defined in the edge function") did not catch it: it asserts only that the title is
non-empty and differs from the slug, and the `errorMessage` fallback satisfies both. The test
needs to actually prove the title came from the map.

## Changes

| File | Change |
| --- | --- |
| `src/pages/admin/Enrichment.tsx` | Keep `status`/`error_message` from the latest run; render a destructive notice with `explainRunError` + the raw message when it failed |
| `src/lib/jobRunErrorHelp.ts` | Entry for the missing-Vault-secret message |
| `src/lib/alarmDisplay.ts` | Add `outreach_bounce_rate` and `job_failing_repeatedly` |
| `supabase/functions/_shared/alarm.ts` | Add `job_failing_repeatedly` to `AlarmKind` |
| `supabase/migrations/<ts>_alarm_on_repeated_job_failure.sql` | Sweep function + daily cron |
| `tests/unit/alarmDisplay.test.ts` | Make the sync test actually fail on a missing entry |
| `tests/unit/Enrichment.test.tsx` | Cover the failure render |

### The sweep (defect 2)

A scheduled database function rather than a change to `logRun`: the enrichment failure row is
written by SQL (`run_enrich_business_email`), not through `logRun`, so a change there would
miss the very case that prompted this. A sweep covers every job, including ones that fail by
never reporting at all.

- Counts trailing consecutive failures per job — rows newer than that job's most recent
  success.
- Raises at **3**. For daily jobs that is three days: prompt, but past the point where one
  transient network failure looks like a pattern.
- Re-alarms at most once every **3 days** per job. Without this a stuck job produces a fresh
  banner every morning and the banner becomes wallpaper — which is how the underlying message
  got ignored in the first place.
- Runs at 16:00 UTC, after the canary (14:00), enrichment (13:00) and the drip (15:00), so a
  morning's outcome is judged the same day.

### Rollback
Revert the source files; `cron.unschedule('alarm-failing-jobs-daily')` and drop the function.
No data migration, no schema change.

## Acceptance criteria
- [ ] A failed enrichment run renders an explicit error on the Enrichment page, with the
      instructions, instead of a blank
- [ ] A successful run still renders its normal summary
- [ ] 3 consecutive failures raise a banner alarm; 2 do not
- [ ] A still-failing job does not re-alarm daily
- [ ] Every `AlarmKind` has a real title, proven by a test that fails when one is missing
- [ ] Full suite passes
