# Implementation Plan: Skip lead-notification emails to known-dead business addresses, and show it

## Objective
`submit-directory-lead` (the edge function that emails a business every time a homeowner
requests a quote through their listing) sends to `business.email` unconditionally. It never
checks `businesses.email_undeliverable_at` or `businesses.outreach_suppressed_at` — the two
flags that `send-outreach-drip` already respects. So a business already proven dead (auto-
detected from a real bounce) or manually suppressed from the Replies screen still gets pinged
every time a new lead comes in.

This plan closes that gap, and — per explicit request — makes the skip **visible**, not a
silent behavior change: a badge on the bounce row that caused the suppression, and a running
counter on the admin Overview dashboard, so the mechanism is verifiable at a glance instead of
something you have to take on faith.

## Acceptance Criteria
- [x] `submit-directory-lead` does not attempt to send when `business.email_undeliverable_at`
      or `business.outreach_suppressed_at` is set; the lead itself is still saved either way.
- [x] The skip is recorded on the `directory_leads` row in a field distinct from a genuine SMTP
      failure (`notify_error`), so "we knew not to try" and "we tried and it broke" never look
      the same in the data.
- [x] The skip is recorded in `job_run_logs` metadata (status `"partial"`), matching how
      `send-outreach-drip` already logs skip reasons.
- [x] Replies.tsx: a bounce row whose matched business has `email_undeliverable_at` set shows
      an explicit "Auto-suppressed since <date>" badge (emerald, ShieldOff icon), so looking at
      the exact row from the screenshot proves the mechanism fired.
- [x] Admin Overview dashboard shows a count of lead notifications skipped for a dead/suppressed
      email in the selected date range, so the mechanism's effect is visible on an ongoing basis,
      not just per-row.
- [x] No change to `send-outreach-drip`, `unsubscribe`, or `receive-inbound-email` — those paths
      already work correctly and are out of scope.

## Component Discovery
### Reused Existing
- `businesses.email_undeliverable_at` / `outreach_suppressed_at` — already the source of truth;
  no new suppression concept is introduced.
- `directory_leads.notify_error` — kept as-is for genuine send failures; a new column is added
  alongside it rather than overloading its meaning (see Database Migrations).
- `logRun()` (`supabase/functions/_shared/directory.ts:332`) — reused as-is for job-run logging.
- `Badge` (`src/components/ui/badge.tsx` via shadcn) — reused for the new Replies.tsx indicator,
  same component already used for "Handled" / "Looks like a question" badges on the same row.
- `KpiCard` (`src/components/admin/analytics/KpiCard.tsx`) — reused on Overview.tsx for the new
  skipped-notifications count, matching how every other Overview metric is presented.

### New (Justified)
- None. This is a gap-closing fix using the existing suppression columns and existing UI
  primitives; no new component, hook, or table is needed.

## Files Changed
| File | Change Type | Reason |
|------|-------------|--------|
| `supabase/migrations/20260824010000_directory_lead_skip_reason.sql` | new | Adds `directory_leads.notify_skipped_reason text` so a deliberate skip is distinguishable from a delivery failure. |
| `supabase/functions/submit-directory-lead/index.ts` | modify | Select `email_undeliverable_at, outreach_suppressed_at` on the business lookup (~line 176); before the send block (~line 222), check both flags and skip the send, writing `notify_skipped_reason` instead of attempting `sendOutreachEmail`; include the skip reason in the `logRun` metadata (~line 265). |
| `src/pages/admin/Replies.tsx` | modify | Extend `BusinessInfo` (line 22) and both business `select()` calls (lines ~103, ~121) to include `email_undeliverable_at`; render an "Auto-suppressed" badge next to the existing business name span (~line 344) when it's set. |
| `src/pages/admin/Overview.tsx` | modify | Add one more count query (skipped lead notifications, `directory_leads.notify_skipped_reason not null` within the selected range, with a `*Prev` counterpart for the trend arrow) alongside the existing `Promise.all` batch (~line 76); add one `KpiCard` to the metrics grid. |

## Database Migrations
`supabase/migrations/20260824010000_directory_lead_skip_reason.sql`:

```sql
-- Distinguishes "we deliberately didn't try to email this business" from a
-- genuine send failure (notify_error). Read by submit-directory-lead (write)
-- and the admin Overview dashboard (read, for the skipped-notifications count).
alter table public.directory_leads
  add column if not exists notify_skipped_reason text;

comment on column public.directory_leads.notify_skipped_reason is
  'Set when the business notification email was deliberately not sent '
  '(e.g. business.email_undeliverable_at or outreach_suppressed_at was set '
  'at submit time). Null means either it was sent, or it failed and '
  'notify_error explains why — never both columns at once.';
```

Rollback:
```sql
alter table public.directory_leads
  drop column if exists notify_skipped_reason;
```

No backfill: existing rows predate this check and were never skipped by it, so leaving them
`null` is correct, not a data gap.

## Test Strategy
- Unit tests for `submit-directory-lead` (add to its existing test file if one exists, else new
  `supabase/functions/submit-directory-lead/index.test.ts` following the pattern used elsewhere
  in `supabase/functions/_shared`/other function tests):
  - business with `email_undeliverable_at` set → no `sendOutreachEmail` call, lead row gets
    `notify_skipped_reason` set, `notified_at` stays null, response is still `{ success: true }`.
  - business with `outreach_suppressed_at` set → same behavior.
  - business with neither flag set and a valid email → unchanged existing behavior (send
    attempted, `notified_at`/`notify_error` set from the real result).
  - business with no email at all → unchanged existing "Business has no email on file." path.
- Integration/manual verification:
  - Re-run the Thynk Remodeling scenario: business already has `email_undeliverable_at` set
    (confirmed live in this session) — submit a test lead against that business id and confirm
    no outbound email attempt in `email_send_log`, and `directory_leads.notify_skipped_reason`
    is populated.
  - Load `/admin/replies`, confirm the Thynk Remodeling bounce row now shows the
    "Auto-suppressed" badge without clicking anything.
  - Load `/admin` (Overview), confirm the new KPI count is non-zero after the test lead above,
    and updates when the date range changes.
- Regression check: `send-outreach-drip`'s existing filters and `Overview.tsx`'s existing
  `eligible`/`pausedWithEmail` counts are untouched — diff should show only additive changes to
  those files.

## Rollback
- Revert the four changed files via `git revert`.
- Run the migration rollback SQL above to drop `notify_skipped_reason` (safe: nothing else
  depends on it, and dropping it is non-destructive to any other column).
- No cron jobs, edge function schedules, or external config reference this column, so no other
  cleanup is required.
