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
- [x] A failed enrichment run renders an explicit error on the Enrichment page, with the
      instructions, instead of a blank — five jsdom tests, including a failure with no
      recorded reason and one with no catalogued explanation
- [x] A successful run still renders its normal summary
- [x] Every `AlarmKind` has a real title, proven by a test that fails when one is missing —
      confirmed by mutation: removing one entry makes the test fail and name it
- [x] Full suite passes — 69 files / 690 tests, zero type errors, deployed and live
- [~] **3 consecutive failures raise a banner alarm; 2 do not.** The detection half is
      verified against real production data read-only: it selects `enrich-business-email`
      (29 failures, live) and correctly excludes `unsubscribe` (3 failures, 28 days stale).
      The insert half is not yet observed — the Supabase MCP connection is read-only, so
      calling the function fails for the connection's reason rather than the function's, and
      invoking things to "check they work" is what caused the accidental send on 2026-08-29.
      It fires on its own at 16:00 UTC.
- [~] **A still-failing job does not re-alarm daily.** Implemented as a `NOT EXISTS` guard on
      an alarm for the same job within 3 days; unobserved until the second run, 2026-09-27.

## Expected on first run
The sweep will raise one alarm, for `enrich-business-email`. That is the intended outcome, not
a new fault — the job has genuinely been failing since 2026-08-28 for want of the
`supabase_secret_key` Vault secret.

---

# Follow-up shipped 2026-09-26: B copy live, removal requests caught

Both done, deployed and verified.

## Why not the A/B split that was planned
At the observed ~31% enrichment hit rate there are roughly 145 usable addresses left in the
entire directory. A 50/50 split gives ~70 per arm — too few to separate a real difference in
opt-out rate from noise. A has already had its trial: 31 sends, 3 unsubscribes, 1 bounce, 0
replies expressing interest, 0 claims. So B is now the only active variant and A is
deactivated (not deleted — `outreach_sends` references `variant_key`). The migration raises
rather than leave a stage with no active variant, which would silently halt half the campaign.

## Removal requests
The B copy invites "reply and I'll take it down". That reply previously matched no rule and
landed as `unclassified`. It is now its own classification: suppressed automatically on the
same footing as an unsubscribe, always priority, destructive badge in /admin/replies. The
listing takedown itself stays human — nothing here publishes or unpublishes.

Checked before unsubscribe, which preserves the existing guarantee rather than weakening it
(both suppress). "remove me from your list" deliberately stays an unsubscribe.

## Context worth carrying forward
Copy is unlikely to be the binding constraint. In the month since analytics was restored the
site had ~34 visitors, 5 of whom viewed the directory, and there have been **0** homeowner
quote requests through a listing, ever. The email promises contractors that homeowner requests
will arrive; today that offer has nothing behind it. Judge the next batch on replies, not
claims.

## Verified
- 70 test files / 708 tests, 0 type errors, `deno check` clean, frontend deploy confirmed live
  by bundle hash change, `receive-inbound-email` redeployed
- Both sync tests (alarm kinds, inbound classifications) confirmed to fail by mutation, not
  just to pass
