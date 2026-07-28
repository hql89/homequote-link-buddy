# Implementation Plan: Admin Settings Honesty Pass

**Status:** Draft — awaiting approval
**Date:** 2026-07-27
**Scope decision:** Frontend only. No migration, no edge-function redeploy.
**Not to be confused with:** the root `implementation_plan.md` (Business Ingestion Engine),
which is still live and whose Phase 2 is the Perplexity enrichment this plan un-renders.

## Objective

Three admin surfaces currently assert things the code cannot know. Background Jobs renders a
confident "Off" badge for jobs whose status it failed to fetch; System Status claims a
publish schedule that does not exist; and the Settings page ships a Perplexity panel that
writes a credential no code path reads. This pass makes each surface tell the truth about its
own state, and adds the one genuinely missing control (`send-outreach-drip-daily`) behind a
confirmation dialog, since enabling it starts autonomous cold email to real businesses.

Nothing here installs `pg_cron`, deploys a function, or changes what any job does. The
backend stays exactly as capable — and as inert — as it is today.

## Acceptance Criteria

- [ ] The Perplexity panel no longer renders on `/admin/settings`
- [ ] `PerplexitySettings.tsx` and its test remain in the repo, unmodified and passing, so
      Phase 2 re-enables it by restoring one import and one JSX line
- [ ] When `admin_list_cron_jobs` fails because `pg_cron` is absent, Background Jobs shows an
      explicit "scheduling unavailable on this database" state — never an "Off" badge
- [ ] When it fails for any other reason (e.g. `Forbidden`), the panel shows the error message
      rather than silently rendering toggles
- [ ] Every job switch is `disabled` while scheduling is unavailable
- [ ] A `send-outreach-drip-daily` entry exists in Background Jobs, off by default
- [ ] Enabling it opens an AlertDialog naming the consequence — daily email to real
      businesses, no per-send review — and no RPC fires unless the user confirms
- [ ] Disabling it needs no confirmation (stopping outbound email is always safe)
- [ ] System Status's Scheduled Tasks empty state states no schedule it cannot verify
- [ ] `npm run test` passes; `npm run lint` introduces no new warnings
- [ ] Diagnostics and Recent runs are untouched and still render

## Component Discovery

### Reused Existing

- `AlertDialog` (`@/components/ui/alert-dialog`) — the confirm pattern already used in
  `Ingest.tsx`, `Reviews.tsx`, `Verticals.tsx`, `MediaLibrary.tsx`. No new confirm primitive.
- `HelpTip` (`@/components/admin/HelpTip`) — already used throughout this panel for exactly
  this kind of "what does this actually mean" copy.
- `Switch`, `Badge`, `Button`, `Label`, `ScrollArea` — all already imported by the panel.
- Existing `MANAGED_JOBS` array — the new job is one more entry, not a new mechanism.
- Error-state shape copied from `SystemStatus.tsx:95` (the only existing `isError` branch in
  the admin app), so the two pages fail the same way.

### New (Justified)

- `src/lib/cronAvailability.ts` — a pure `classifyCronError(error)` returning
  `"unavailable" | "forbidden" | "unknown"`. Existing `extractEdgeError` handles
  `functions.invoke` responses (reads `error.context` as a `Response`); this is a PostgREST
  RPC error with a SQLSTATE `code`, a different shape entirely. Kept as a separate pure
  module so it is unit-testable without rendering, mirroring `src/lib/jobRunSummary.ts`
  which this same panel already imports.

## Files Changed

| File | Change Type | Reason |
|------|-------------|--------|
| `src/pages/admin/Settings.tsx` | modify | Drop the `PerplexitySettings` import and render; leave a comment tying the removal to Phase 2 of the ingest plan so it is restored deliberately, not rediscovered |
| `src/lib/cronAvailability.ts` | **new** | Classify the RPC failure so the UI can distinguish "extension missing" from "forbidden" from "something else" |
| `src/pages/admin/settings/BackgroundJobsSettings.tsx` | modify | Consume `isError`/`error`; render the unavailable/error states; disable switches when unavailable; add the `send-outreach-drip-daily` entry and its confirmation dialog |
| `src/pages/admin/SystemStatus.tsx` | modify | Replace the empty-state sentence that claims `publish-scheduled` runs every 5 minutes |
| `tests/unit/cronAvailability.test.ts` | **new** | Unit-test the classifier against real SQLSTATE payloads |
| `tests/unit/BackgroundJobsSettings.test.tsx` | **new** | Regression test: unavailable state renders instead of "Off"; outreach toggle fires no RPC without confirmation |

Unchanged and deliberately so: `PerplexitySettings.tsx`, `tests/unit/PerplexitySettings.test.tsx`,
`AccountSettings`, `AnalyticsSettings`, `SMTPSettings`, `EmailTemplatesSettings`, `ResponseLog`.

## Technical Notes

**Detecting the missing extension.** `admin_list_cron_jobs` is `SECURITY DEFINER` with
`SET search_path = public, cron` and selects from `cron.job` with no guard. With `pg_cron`
absent, the body fails at runtime and PostgREST returns SQLSTATE `42P01`
(`undefined_table`), message `relation "cron.job" does not exist`. The admin check above it
raises `Forbidden` as a plpgsql exception, which surfaces as `P0001`. The classifier keys on
`code` first and falls back to a message match on `cron.job`, so a PostgREST version that
reshapes the payload degrades to `"unknown"` — showing the raw error — rather than
mislabelling a permissions problem as a missing extension.

**The confirmation only guards enabling.** `onCheckedChange` receives the target state; when
`enable === false` the mutation fires immediately. Only `enable === true` on a job flagged
`confirmBeforeEnable` opens the dialog. The switch stays visually off until the RPC succeeds,
so a dismissed dialog leaves no misleading intermediate state.

**Why the outreach toggle is worth adding even though it cannot fire yet.** It is the only
managed job whose function is actually deployed (`send-outreach-drip`, v3, 2026-07-25) and a
recognised name in `admin_toggle_cron_job`. Until `pg_cron` lands it renders disabled under
the same unavailable notice as the others — so this adds a correct, honest control, not a
fourth dead switch.

## Database Migrations

**None.** No schema, RPC, RLS, or extension changes. `admin_list_cron_jobs` and
`admin_toggle_cron_job` are read and called exactly as they are today.

## Test Strategy

**Unit — `cronAvailability.test.ts`**
- `{ code: "42P01", message: 'relation "cron.job" does not exist' }` → `"unavailable"`
- `{ code: "P0001", message: "Forbidden" }` → `"forbidden"`
- Message-only fallback (no `code`, message mentions `cron.job`) → `"unavailable"`
- `null` / a plain `Error` / an unrelated SQLSTATE → `"unknown"`

**Unit — `BackgroundJobsSettings.test.tsx`** (mocking the supabase client, same approach as
`PerplexitySettings.test.tsx`)
- RPC rejects with `42P01` → the unavailable notice renders, and no "Off" badge appears
- RPC rejects with `42P01` → every switch is disabled
- Clicking the outreach switch on opens the dialog and calls no RPC; dismissing it still
  calls no RPC
- RPC resolves normally → existing behaviour is unchanged (badges and switches render)

**Regression** — `npm run test` over the full suite; `jobRunSummary.test.ts` and
`PerplexitySettings.test.tsx` must still pass untouched, proving the panel's summary logic
and the parked Perplexity component were not disturbed.

**Manual verification** — load `/admin/settings` against the real project, where `pg_cron` is
genuinely absent, and confirm the unavailable notice appears rather than three "Off" badges;
confirm the Perplexity panel is gone and the other six panels render; load `/admin/system`
and confirm the Scheduled Tasks card no longer claims a 5-minute schedule.

## Rollback

`git revert` of the single commit. Every change is frontend-only with no persisted state, no
migration, and no deployed-function change, so a revert restores prior behaviour exactly on
the next Vercel build. No data written, none to unwind.

## Out of Scope — deliberately left, with reasons

These are real and stay open after this pass:

1. **`pg_cron` is not installed.** Per your call, this pass makes the UI honest about that
   rather than changing infrastructure. Worth its own plan alongside deploying
   `publish-scheduled` and `send-nurture-emails`, since 2 of the 4 jobs point at functions
   that currently 404.
2. **`system-status` calls a non-existent RPC.** It invokes `get_cron_jobs`, which appears in
   no migration; the `catch` swallows it and returns `[]`. The Scheduled Tasks card therefore
   *always* shows the empty state. This pass fixes the false copy but not the cause — the fix
   is repointing it at `admin_list_cron_jobs`, which needs an edge-function redeploy.
3. **The stored Perplexity key.** Removing the panel does not delete
   `admin_settings.perplexity_config`. If a live key is stored there it stays until deleted
   in the Supabase dashboard — a credential nothing reads. **Manual step for you; I have no
   admin credentials for the project.**
4. **`outreach_templates` has no editor.** Read by the deployed `send-outreach-drip` via
   `_shared/directory.ts:94`, editable nowhere. Cold-email copy is locked to code defaults.
5. **SMTP password round-trips to the browser.** Stored plaintext in `admin_settings` and
   loaded into component state at `Settings.tsx:52` so the eye-toggle can reveal it.
   Admin-only at the RLS layer, so not urgent — but it is the opposite of the write-only
   pattern `PerplexitySettings` uses.
