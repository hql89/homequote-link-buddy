# Implementation Plan: Admin visibility — alarms, badges, and pipeline help

**Date:** 2026-08-20
**Status:** Awaiting approval

## Objective

Three related gaps, all versions of "something matters and the admin has no way
to know it." The largest is not a missing feature but an invisible one: this
project already **detects and records four serious conditions** — the outbound
email circuit breaker tripping, an unsubscribe spike, an automatic action whose
write silently failed, and the delivery canary failing — and writes every one of
them to `job_run_logs` with `job_name = 'alarm'`. **Nothing in the admin UI reads
that table.** `alarm.ts`'s own header calls this out and names it as deliberately
unfinished ("NOT implemented here: it needs an n8n Slack/Telegram/SMS node…"), so
the durable record exists and the seeing does not. This plan builds the seeing.

The other two are smaller: the sidebar's badge system tracks four things and none
of them are the directory pipeline, and the five-step pipeline itself is
explained nowhere in the product — only in conversation.

## Acceptance Criteria

- [ ] An alarm raised by any edge function becomes visible in the admin UI within
      one page load, on **every** admin page, not just one feature's screen
- [ ] Each alarm renders in plain language (what happened, when) — never a raw
      `alarm_kind` slug or JSON blob
- [ ] Alarms can be marked as seen, and stay dismissed across reloads and devices
- [ ] Marking as seen is *not* the same as fixing — an unresolved condition that
      re-fires raises a new alarm and reappears
- [ ] The Email Finder sidebar item shows a count of rows waiting for review
- [ ] The "Directory pipeline" sidebar group carries a visible (not hover-only)
      explanation of the five steps
- [ ] No alarm can be silently swallowed by a failed read: if the alarm query
      itself fails, the banner says so rather than rendering "all clear"
- [ ] Gate clean: tests, `tsc --noEmit`, lint, build

## Component Discovery

### Reused existing
- **`Alert` / `AlertTitle` / `AlertDescription`** (`src/components/ui/alert.tsx`) —
  the shadcn primitive already in the project; no reason for a bespoke banner.
- **`useAdminCounts`** (`src/hooks/useAdminCounts.ts`) — already polls counts on a
  5-minute interval and feeds sidebar badges. Extended, not replaced.
- **`admin_settings`** table — already the home for small admin-scoped state
  (`outreach_config`, `enrichment_config`). Verified: `authenticated` holds
  table-level INSERT/UPDATE, so acknowledgement needs **no new grant**.
- **`job_run_logs_job_name_created_at_idx`** — an existing index that exactly fits
  the alarm query (`job_name = 'alarm' ORDER BY created_at DESC`).
- **`FieldHint`** (`src/components/admin/HelpTip.tsx`) — for the pipeline blurb.
  Deliberately **not** `HelpTip`: its own docstring says hover-only help is
  invisible on touch and to anyone not looking for it, and "I forget how this
  works" is precisely that case.

### New (justified)
- **`admin_recent_alarms(p_since timestamptz)` RPC** — `admin_recent_job_runs`
  returns the latest N rows across *all* job names, and the canary alone writes
  ~24 rows a day, so alarms fall off the end within about a week. A filtered,
  `is_admin()`-gated RPC over the existing index is both correct and cheaper than
  raising the generic limit.
- **`src/lib/alarmDisplay.ts`** — pure mapping from `alarm_kind` + metadata to a
  human sentence and severity. Pure so it is testable without a database, matching
  how `outreachReadiness.ts` and `jobRunSummary.ts` are already structured.
- **`src/components/admin/AlarmBanner.tsx`** — the banner itself, mounted once in
  `AdminLayout` so it appears on every admin screen.

## Design decisions worth stating

**Acknowledgement is a timestamp, not a column.** A single `alarms_seen_up_to`
value in `admin_settings`; the banner shows alarms newer than it. This avoids
adding alarm-specific columns to `job_run_logs`, which is a generic log table
shared by every background job. It also means acknowledgement is per-account-wide
rather than per-row, which is the right granularity for one operator.

**`job_run_logs` is no longer pruned** (fixed in `20260801170000`, deliberately —
it is the only surviving record of several real incidents). So alarms persist
indefinitely, which makes the acknowledgement mechanism load-bearing rather than
cosmetic: without it, one alarm from August nags forever.

**No permanent "outreach blocked" sidebar badge.** Considered and rejected.
Outreach not sending is the *normal* steady state today (cron off by choice,
almost everyone paused), so a standing red badge would be noise that trains the
eye to ignore badges — including the review-queue one that is genuinely
actionable. Outreach state is already answered by the readiness panel on arrival,
and genuine outreach *events* (circuit breaker, canary failure) come through the
alarm banner. Revisit if outreach becomes always-on.

**Marked-as-seen ≠ resolved.** Stated in the UI copy. The conditions that raise
these alarms re-raise on each recurrence, so dismissing hides the notice, not the
problem.

## Files Changed

| File | Change | Reason |
|------|--------|--------|
| `supabase/migrations/<ts>_admin_recent_alarms.sql` | new | Filtered, admin-gated alarm RPC |
| `src/lib/alarmDisplay.ts` | new | Pure kind→sentence mapping + severity |
| `src/components/admin/AlarmBanner.tsx` | new | Renders unseen alarms; mark-as-seen |
| `src/components/admin/AdminLayout.tsx` | modify | Mount banner; pipeline group blurb |
| `src/hooks/useAdminCounts.ts` | modify | Add Email Finder review-queue count |
| `tests/unit/alarmDisplay.test.ts` | new | Every kind maps; unknown kind degrades safely |
| `tests/unit/AlarmBanner.test.tsx` | new | Renders, dismisses, and fails honestly |
| `tests/unit/AdminLayoutNav.test.tsx` | modify | Assert the pipeline blurb is present |

## Database Migrations

One migration, function-only — no table or column changes.

```sql
CREATE OR REPLACE FUNCTION public.admin_recent_alarms(p_since timestamptz DEFAULT NULL)
RETURNS TABLE (id uuid, error_message text, metadata jsonb, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT l.id, l.error_message, l.metadata, l.created_at
  FROM public.job_run_logs l
  WHERE l.job_name = 'alarm'
    AND (p_since IS NULL OR l.created_at > p_since)
  ORDER BY l.created_at DESC
  LIMIT 50;
END; $$;

REVOKE EXECUTE ON FUNCTION public.admin_recent_alarms(timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_recent_alarms(timestamptz) TO authenticated;
```

**Rollback:** `DROP FUNCTION IF EXISTS public.admin_recent_alarms(timestamptz);`

## Test Strategy

- **Unit (`alarmDisplay`)** — every one of the four `AlarmKind` values produces a
  sentence; an unknown/future kind degrades to the recorded `error_message`
  rather than rendering a slug or throwing. Pinned against `alarm.ts`'s union by
  reading the source, same technique used for `DELIVERY_PROOF_MAX_AGE_DAYS`.
- **jsdom (`AlarmBanner`)** — renders unseen alarms; hides once acknowledged;
  writes `alarms_seen_up_to` merged (not overwriting sibling `admin_settings`
  keys); and — the important one — renders an explicit failure notice when the
  RPC errors, never a silent "all clear".
- **jsdom (`AdminLayoutNav`)** — extend the existing real-render test to assert
  the pipeline explanation is present as visible text.
- **Manual** — cannot be verified in-browser from here (admin routes are
  auth-gated, per `homequote-admin-ui-verification`). Verification is the jsdom
  tests plus, after deploy, grepping the served bundle for the new strings —
  the same method used for the last four features.

## Rollback

- `git revert` the commit; all four new files are additive and the three modified
  files have no schema dependency.
- Drop the RPC with the statement above. Nothing else reads it.
- No data migration to unwind: `alarms_seen_up_to` is one key in an existing
  JSONB blob and is ignored by everything else if left behind.

## Explicitly out of scope

- **Push notification (Slack/Telegram/SMS).** `alarm.ts` names this as the real
  end state, and it is n8n infrastructure rather than code. This plan closes the
  gap between "recorded" and "visible in the product"; it does not close the gap
  between "visible when you look" and "reaches you when you aren't looking."
  Worth doing next, and worth saying plainly that this plan does not do it.
- **Adding help text to the 19 admin pages that have none.** Scoped here to the
  pipeline group only; the rest is a larger content pass.
- **Any change to what raises an alarm.** The four existing kinds and their
  triggers are untouched.
