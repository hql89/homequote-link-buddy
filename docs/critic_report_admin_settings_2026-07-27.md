# Critic Report — Admin Settings Honesty Pass

**Date:** 2026-07-27
**Plan:** `docs/plans/implementation_plan_admin_settings_cleanup_2026-07-27.md`
**Verdict:** No blockers. One over-claim found and fixed during the pass; five issues found
and deliberately left, listed below with reasons.

> The root `critic_report.md` (2026-07-25, directory pivot Phase 1) is a different, completed
> pass and was not overwritten.

## Found and fixed during the pass

### 1. The success toast claimed more than the code checked

`admin_toggle_cron_job` writes a `cron.job` row. That's all it does. The toast said the job
"is now running on schedule" — but `publish-scheduled-posts` and `send-nurture-emails-hourly`
post to `publish-scheduled` and `send-nurture-emails`, **neither of which is deployed**
(verified against `supabase functions list`). Enabling either would have reported success
while scheduling an HTTP POST to a 404 every 15 minutes / every hour.

Changed to "is now scheduled" — accurate for all four jobs, and it stops the panel making a
liveness claim it never verified. This was the same defect class the pass exists to remove,
sitting inside the flow being certified, so it was fixed rather than filed.

## Found and deliberately left

### 2. Diagnostics and Recent runs still swallow their errors  *(same bug class, one panel down)*

`admin_database_diagnostics` failing renders "Diagnostics are not available yet."
`admin_recent_job_runs` failing renders "No runs recorded yet." Both read as benign empty
states; both can equally mean the query threw. This is precisely the bug just fixed for the
job list, twice, forty lines below it.

**Left because** the approved plan states "Diagnostics and Recent runs are untouched and still
render" as an acceptance criterion. Fixing them would violate the scope that was approved.
It is a small, mechanical change — the `CronFailureNotice` pattern applies directly — and
worth its own follow-up.

### 3. The outreach toggle depends on an unverified migration

`send-outreach-drip-daily` is only a recognised job name in
`20260725150000_fix_cron_admin_toggle_project_ref.sql`. If that migration hasn't been applied
to `lrqdbpphallqehpdqalr`, confirming the dialog raises `Unknown job: send-outreach-drip-daily`.

**Unverifiable here** — checking applied migrations needs DB credentials the repo doesn't
carry. Currently unreachable anyway: the switch is disabled while pg_cron is absent. Confirm
the migration is applied before installing pg_cron.

### 4. The panel can't know an edge function is undeployed

Two of the four managed jobs target functions that return 404. The UI has no way to detect
this — deployment state isn't exposed to the browser — so it can't warn. Fabricating a
warning from a hardcoded list would rot the first time something is deployed.

**Left as a documentation problem**, not a UI one. Deploying `publish-scheduled` and
`send-nurture-emails` alongside installing pg_cron is the actual fix.

### 5. A disabled switch still *looks* off during "Status unknown"

When the schedule can't be read, the switch renders in its off position because a two-state
control has nowhere else to sit. Mitigated three ways: the switch is `disabled`, the badge
reads "Status unknown" rather than "Off", and the notice above states plainly that the state
is unknown rather than off. Accepted as the limit of the control, not a defect in the fix.

### 6. The stored Perplexity key outlives the panel

Removing the render does not delete `admin_settings.perplexity_config`. If a live key was
saved, it remains in the database with nothing reading it.

**Requires manual deletion in the Supabase dashboard** — no admin credentials available here.

## Verification performed

| Check | Result |
|---|---|
| `npm run test` | 16 files, **152 passed**, 0 failed |
| `tsc --noEmit -p tsconfig.app.json` | clean, exit 0 |
| `eslint` on all six changed files | clean, exit 0 |
| `npm run build` | succeeds in 7.8s |
| Perplexity absent from `dist/assets/` | confirmed — zero matches, fully tree-shaken |
| New copy present in `dist/assets/Settings-*.js` | confirmed |
| Dev server loads `/admin/settings` | redirects to login, **zero console errors** |
| `PerplexitySettings.test.tsx` still passes untouched | 4/4 — parked component intact |
| ResizeObserver errors in `ProviderDashboardInfinite.test.tsx` | **pre-existing** — reproduced with changes stashed |

The admin panel itself could not be viewed rendered: `/admin/settings` is auth-gated and
signing in is not something to do on the user's behalf. Panel behaviour is covered by the
eight DOM-level tests in `tests/unit/BackgroundJobsSettings.test.tsx` instead, which assert
against the real component and a mocked RPC layer.
