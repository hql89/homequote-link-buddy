# Implementation Plan: Restore measurement, add an email B variant, schedule enrichment

## Context

20 businesses have been emailed. 3 unsubscribed (15%), 1 hard-bounced, 0 claimed their
listing, 0 replied with interest. The drip has ~6 sends of runway left before it starves.

The temptation is to open the enrichment valve and refill the pool from the 472 queued
businesses. That would send the same zero-converting message to 20x more people. This plan
does the two things that make the next batch informative first, and only then refills.

Executed in three ordered phases. Each phase is independently shippable.

---

## Phase 1 — Restore site analytics

### Root cause (verified, not assumed)

Commit `922bf81` ("feat: refactor admin settings and integrate GA4 tracking") rewrote
`trackEvent()` in `src/services/analyticsService.ts` to send events to Google Analytics via
`gtag` **instead of** the Supabase `analytics_events` table. The Supabase write was removed
entirely. That is the sole reason the table has been empty since 2026-03-22.

Things that are NOT the cause, checked and ruled out:
- Page-view tracking IS wired: `App.tsx` renders `<PageTracker />` → `usePageTracking()` →
  `trackPageView()` on every route change. This has been correct the whole time.
- The `track-event` edge function is deployed and ACTIVE, takes `verify_jwt: false`, and
  inserts with the service-role key, so there is no RLS or auth obstacle.
- `VITE_GA_MEASUREMENT_ID` is set in local `.env` and `gtag` is loaded in `index.html`.

Consequence beyond the missing data: `src/pages/admin/SiteAnalytics.tsx` reads
`analytics_events` and has been rendering a dashboard built on a table frozen in March.

### Why restore the Supabase write rather than lean on GA4

The question this is meant to answer is "did the outreach emails bring anyone to the site."
Answering it from GA4 means a human opening a console. Answering it from `analytics_events`
means a SQL query, which is checkable directly and can be joined against `outreach_sends`.
The claim links in Email 2 carry `?token=<claim_token>`, which uniquely identifies a business,
so a server-side record can attribute a visit to the exact business that was emailed.

GA4 stays — this is a dual write, not a revert.

### Files changed
| File | Change |
| --- | --- |
| `src/services/analyticsService.ts` | Restore the `track-event` invoke alongside the existing `gtag` call. Redact secrets from the recorded URL (see below). Neither sink may break the other or the page. |
| `tests/unit/analyticsService.test.ts` | New. Covers dual-write, token redaction, opt-out paths, and failure isolation. |

### Security constraint on this phase

`page_url` currently records `window.location.href` verbatim. The claim URL is
`/directory/:city/:slug/claim?token=<claim_token>` and that token is the credential that
authorizes claiming a listing. Writing it into an analytics table widens exposure of a live
secret. **`token` and any `*_token` query parameter must be redacted before the event is
sent**, in both `page_url` and `page_path`. Attribution is preserved by recording that a
token was present, not its value.

### Test strategy
Vitest + jsdom (`vitest.config.ts` already includes `tests/**`), mocking
`@/integrations/supabase/client` and `window.gtag`, matching the existing
mocked-supabase-client convention used across `tests/unit`.

- page_view invokes `track-event` with the expected payload shape
- `?token=` is redacted from `page_url` and `page_path`; non-secret params survive
- `hql_ignore_tracking` opt-out suppresses both sinks
- a Lovable preview hostname suppresses both sinks
- a throwing/rejecting supabase invoke does not prevent the `gtag` call and does not throw
- a missing `window.gtag` does not prevent the supabase invoke

### Rollback
Revert the single source file. No schema change, no deploy dependency.

### Acceptance criteria
- [x] A page view on a non-admin route inserts a row into `analytics_events` — verified twice:
      against the dev server, then against production after deploy
      (`https://www.homequotelink.com/faq`, 2026-08-27 20:50 UTC, the first new row since
      2026-03-22)
- [x] No `analytics_events` row ever contains a claim token — verified in a real browser with a
      canary token: stored `page_url` came back `...claim?token=redacted&city=encino`, with the
      non-secret `city` param intact
- [x] GA4 continues to receive the same events it does today
- [x] Either sink failing leaves the other working and the page unbroken
- [x] Admin analytics dashboard shows live data again — established by the data, not by opening
      the page: `SiteAnalytics.tsx` reads `analytics_events`, which is now being written. The
      route is admin-gated, so its rendering stays covered by `SiteAnalytics.test.tsx`.
- [x] Full test suite passes with no new failures — 67 files / 627 tests. The 34 `tsc` errors
      are pre-existing stale-generated-types debt in five admin files, none of them touched
      here; `npm run build` is clean.

### Found while verifying, fixed in the same phase
Restoring the server-side sink meant local development began filing real page views into the
production table — the host check skipped Lovable preview domains but not localhost, which was
harmless only while there was no sink to write to. Loopback, `*.localhost` and `*.local` now
skip, and migration `20260827030000` removed the three rows that landed first.

---

## Phase 2 — Write a B variant for both outreach emails

### Problem
`outreach_template_variants` holds exactly one row per email type, both `variant_key = 'A'`.
The A/B selection machinery in `send-outreach-drip` runs on every send and has never had a
second variant to choose between — every email ever sent has been variant A by default. The
15% unsubscribe rate therefore has no comparison point.

### Approach
Add a `B` row for `outreach_verify` (Email 1) and `outreach_preview` (Email 2), written to
test a specific hypothesis rather than to be arbitrarily different.

Hypothesis: variant A leads with what *we* built ("Your listing is ready for preview",
"Quick question about {{business_name}}") and asks a stranger to act on an unsolicited
listing. Variant B leads with the concrete thing the contractor gets — a named homeowner
request in their own city — and asks for a yes/no rather than a click into a claim flow.

**Inserted with `is_active = false`.** The copy goes to real local business owners; it is
reviewed before it can send. Activation is a one-line SQL update, called out in the handoff.

### Files changed
| File | Change |
| --- | --- |
| `supabase/migrations/<ts>_outreach_variant_b.sql` | Insert two inactive B rows |
| `tests/unit/OutreachVariants.test.tsx` | Assert the admin Outreach screen renders multiple variants and marks inactive ones as inactive |

### Verification before writing the migration
- Read `send-outreach-drip` variant selection to confirm `is_active = false` is genuinely
  excluded from the pool (if it is not, this phase is unsafe as designed and must change)
- Confirm the exact column set and placeholder syntax of the existing A rows

### Rollback
`delete from outreach_template_variants where variant_key = 'B'`. Nothing has been sent while
the rows are inactive, so there is no partial-campaign state to unwind.

### Acceptance criteria
- [x] Two B rows exist, both inactive — confirmed in `outreach_template_variants`
- [x] Placeholders used by B are within what each stage's `vars` map builds — now enforced by
      `tests/unit/outreachVariantPlaceholders.test.ts`, which also covers the existing A copy
- [x] No send path can select an inactive variant — `pickOutreachVariant` filters with
      `.eq("is_active", true)` and `pickVariant` filters again; both already covered by
      `outreachVariants.test.ts`
- [x] The exact copy is surfaced to the user for approval before activation

### Note added during implementation
`renderTemplate` substitutes an unknown placeholder with an empty string, so a placeholder that
a stage does not build is neither a build error nor a runtime error — it is a blank space in an
email already delivered to a real business owner. Email 1 has no `claim_url`. That is what the
new test exists to prevent.

---

## Phase 3 — Put enrichment on a schedule

### Problem
`enrich-business-email` is enabled (`{"enabled": true, "daily_limit": 5}`), has a working
Perplexity key, and has no cron entry. `cron.job` holds only `email-canary-check`,
`prune-internal-job-logs-daily`, and `send-outreach-drip-daily`. It runs only when someone
clicks the admin button, which last happened 2026-08-20. 472 published businesses are
un-enriched.

### Throughput
64 enriched so far have yielded 20 usable emails — a ~31% hit rate. At 5/day that is ~1.5
new emails/day against a drip that wants 5/day, and ~94 days to clear the queue. The limit
needs to rise for the drip to stay fed.

### Approach
1. Add a `pg_cron` entry. `enrich-business-email` has `verify_jwt: true`, unlike the two
   functions already on cron — the existing `email-canary-check` command is the reference for
   how the Authorization header is passed. Confirm before writing, do not assume.
2. Raise `daily_limit` from 5 to a value that feeds the drip without running far ahead of it.
3. Schedule it earlier than the 15:00 UTC drip so a day's findings are available to that same
   day's send.

### Cost note
Each enrichment attempt is a Perplexity API call. Raising the limit raises spend
proportionally. The chosen limit is stated explicitly in the handoff rather than buried.

### Rollback
`select cron.unschedule('<jobname>')` and restore `daily_limit` to 5. The `enabled` flag in
`admin_settings` remains an independent kill switch that needs no deploy.

### Acceptance criteria
- [x] Cron entry exists and is active — `enrich-business-email-daily`, `0 13 * * *`
- [x] `daily_limit` raised 5 → 20, from measured run times rather than estimate
- [x] Enrichment writes addresses only; it cannot itself send anything to a business
- [x] The trigger function is not callable by `anon` or `authenticated`
      (`postgres=X | service_role=X`)
- [ ] **BLOCKED — proven to authenticate.** `isPrivilegedCaller` requires the secret key, and
      `vault.secrets` is empty, so the job cannot yet reach the function. Until the secret
      exists each run logs a `failure` row naming it. This is the one step that needs the
      user: add the project's secret (service role) API key in the Supabase dashboard under
      Project Settings → Vault, named exactly `supabase_secret_key`. It must not be committed,
      which is why it is not in a migration.
- [ ] **BLOCKED by the above** — a real run producing a `job_run_logs` row with non-zero
      `considered`. Cannot be verified from here for a second, independent reason: the
      Supabase MCP connection is read-only, so invoking a function that writes fails for the
      connection's reason rather than the function's.

---

## Cross-cutting

### Concurrent session hazard
A second worktree exists at `.claude/worktrees/focused-swirles-e3d0d6` (detached HEAD at
`608ae5b`). Another session may be editing this repo. Every commit must name explicit
pathspecs — never `git add -A` or `git commit -a`.

### Out of scope, surfaced separately
The SMTP password is stored as plaintext in `admin_settings.smtp_config`. Readable by anyone
with database access. Not urgent, not part of this plan, tracked as its own task.
