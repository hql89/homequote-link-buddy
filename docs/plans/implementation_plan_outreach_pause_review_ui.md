# Implementation Plan: Outreach-pause review UI

## Why

Every ingested business is created with `outreach_paused = true` — deliberate,
so ingestion stays silent until reviewed (`process-ingest-queue/index.ts:158-160`).
Nothing in the admin UI can currently flip that back to `false`. The closest
thing, `/admin/enrichment`'s "Confirm" button, only sets `email_confidence`,
not `outreach_paused` (confirmed by reading `reviewEnrichedEmail` in
`src/integrations/supabase/directory.ts:269-286`). So even a fully verified,
un-suppressed business with a real email stays permanently silent with no way
to change that from the browser.

This plan only builds the missing switch. It does not flip anyone's
`outreach_paused` value, does not re-schedule `send-outreach-drip-daily`
(still unscheduled since 2026-08-01), and sends no email. Per the user:
*"i don't want to send any emails just yet."*

## What's broken today, concretely

`outreach_paused` has `SELECT` granted to `authenticated` but **no `UPDATE`**
(verified via `information_schema.column_privileges`). The other three
admin-writable columns on `businesses` (`is_published`, `email_confidence`,
`outreach_suppressed_at`) all have `UPDATE` granted. This is the same failure
mode documented in `supabase/migrations/20260731130000_admin_enrichment_review_grants.sql`
and `20260729150000_admin_reply_actions_grants.sql` — a write shipped without
its column grant dies with "permission denied for table businesses" in
production, after RLS is never even reached. RLS itself is already correct:
the one `UPDATE` policy on `businesses` ("Admins can publish businesses") is
`USING (is_admin()) WITH CHECK (is_admin())` with no column restriction, so
the grant is the only missing layer.

## Files to change

1. **`supabase/migrations/<timestamp>_admin_outreach_pause_grant.sql`** (new)
   `GRANT UPDATE (outreach_paused) ON public.businesses TO authenticated;`
   Same comment/rollback style as the reference migration above. Rollback:
   `REVOKE UPDATE (outreach_paused) ON public.businesses FROM authenticated;`

2. **`src/integrations/supabase/directory.ts`**
   Add `setBusinessOutreachPaused(id: string, paused: boolean)`, same shape
   as the existing `setBusinessSuppressed` a few lines above it.

3. **`src/pages/admin/Enrichment.tsx`**
   Add a new section below "Needs review": **"Ready for outreach"** — lists
   every business where `email_confidence = 'verified' AND email IS NOT NULL`
   (ordered by name), each row showing name / city / email / phone / whether
   Email 1 has already gone out, with a `Switch` (reusing the component
   already imported in this file) reflecting `!outreach_paused`. Toggling
   calls the new helper and refetches. This is a visibility+control surface,
   not a one-shot queue — an admin can re-pause a business here too, not just
   turn it on.

4. **`tests/unit/Enrichment.test.tsx`** (new)
   jsdom test following the exact pattern already established in
   `tests/unit/PhotoModeration.test.tsx` (mocked `directoryDb`, mocked
   `setBusinessOutreachPaused` recording calls, `AdminLayout` stubbed).
   Covers: section lists verified+emailed businesses; toggling calls the
   update fn with the right `id`/`paused` value; toggle state reflects
   `outreach_paused` correctly on load; a business already past Email 1 is
   visibly flagged as already contacted.

## Test strategy

- New jsdom unit test (above) — this is what memory already establishes as
  the pattern for auth-gated admin routes: prove behavior over a mocked
  Supabase client rather than through the real gate.
- After the migration is applied, re-run the `information_schema.column_privileges`
  query to confirm `outreach_paused` now grants `UPDATE` to `authenticated`
  (closing the loop on the exact check that caught the gap).
- Manual pass in the browser preview: load `/admin/enrichment`, confirm the
  new section renders with real data, toggle a switch, confirm no console
  errors and no `permission denied` in the network tab.

## Database migration

One migration, grant-only, no schema/table change. Documented rollback via
`REVOKE`, matching every prior migration of this shape in the repo.

## Rollback procedure

- Revert the three code changes (`directory.ts`, `Enrichment.tsx`, test file)
  via `git revert`.
- Roll back the grant via the `REVOKE` statement in the migration's own
  header comment (same convention as the three prior grant-fix migrations).

## Acceptance criteria

- [ ] `outreach_paused` has `UPDATE` granted to `authenticated` in the DB
- [ ] `/admin/enrichment` shows a "Ready for outreach" section listing
      verified, emailed businesses
- [ ] Toggling the switch persists (confirmed by refetch / page reload)
- [ ] Toggling does **not** touch `is_published`, does **not** touch
      `cron.job`, and triggers no email send — this control only ever writes
      `outreach_paused`
- [ ] No regression to the existing "Needs review" section
- [ ] New jsdom test passes; existing test suite is green

## Explicitly out of scope for this change

- Un-pausing any business (that stays a manual decision made later, by you,
  in the new UI)
- Re-scheduling `send-outreach-drip-daily`
- The delivery-canary n8n workflow (separate, still pending)
