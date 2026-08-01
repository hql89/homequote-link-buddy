# Deployment Report

**Version:** 0.0.11
**Date:** 2026-07-31 18:58 PDT
**Environment:** Production (Vercel → www.homequotelink.com, Supabase `lrqdbpphallqehpdqalr`)
**Commits:** `e4fdde5`, `e651188` (pushed `6b448db..e651188` → `origin/main`)

## Changes Deployed

**`fix(enrichment)` — the review queue could never have worked (e651188)**

`/admin/enrichment`'s Confirm and Dismiss both failed with `permission denied for
table businesses`. The `authenticated` role had column-scoped UPDATE grants for
`is_published`, `outreach_suppressed_at` and `website_url`, but none for the
`email_*` columns, so every click was rejected before RLS was consulted. SELECT is
table-level, so the queue loaded and rendered perfectly — only the click failed,
which is why this shipped looking like a working feature.

- Migration `20260731130000` grants UPDATE on `email`, `email_source_url`,
  `email_source_phone`, `email_source_address`, `email_confidence`.
- `enriched_at` is deliberately **not** granted, so a dismissal is permanent and a
  dismissed row is never picked up by a later enrichment batch.
- Dismiss now also clears `email_source_phone`/`email_source_address` — leaving
  scraped evidence on a rejected row is how stale contact data gets re-trusted.
- `tests/unit/reviewEnrichedEmail.test.ts` pins the written column set. A mocked
  client cannot enforce a Postgres grant, so the guard is against *recurrence*:
  growing either payload fails a test that names the grant migration.

Third occurrence of this class (`is_published` 20260726230000, reply actions
20260729150000, this). Recorded in memory as `homequote-admin-write-column-grants`.

**`feat(enrichment)` — surface site phone/address in the review queue (e4fdde5)**

The queue showed only the CSLB phone, with nothing to compare it against.

- Migration `20260731120000` adds `email_source_phone`, `email_source_address`.
- New `extractAddressFromHtml` pulls a `"City, CA zip"` snippet from the fetched page.
- Review rows now show CSLB city/phone beside the phone and address found on the site.
- Neither field feeds `email_confidence`. Only an automatic phone match still
  promotes a row to `verified` — these are extract-and-surface signals for the human.

## Verification

| Check | Result |
|---|---|
| Tests | ✓ 259 passed, 24 files |
| Type check | ✓ zero errors |
| Lint | ✓ zero errors |
| Production build | ✓ built in 27s |
| npm audit | ⚠ 1 critical, 16 high — **accepted, see below** |

**Security exception (approved by owner before push).** All pre-existing; these two
commits changed no dependencies (`package.json`/`package-lock.json` untouched — verified
by diff). The lone critical is `vitest`, a devDependency whose advisory concerns the
Vitest UI server, which this project never runs. The only high-severity package that
reaches a browser is `react-router-dom`; everything else high (vite, postcss, rollup,
ws, lodash, glob…) is build toolchain absent from the bundle. `npm audit fix` is a
proven no-op here — confirmed by dry run, all 24 remain — because the real target is
`react-router-dom >= 7.18` (the advisory range now extends through 7.17.0), a semver-major
migration. Tracked as existing React Router debt.

**Smoke test (live production, real browser):**

- Bundle identity — `Enrichment-DR_CvkWV.js` on the live host is **byte-for-byte
  identical** to the local build (matching SHA-256), and contains the new strings
  `Phone on site`, `Address on site`, `CSLB city on file`, `email_source_address`.
  Proof the deploy carried this code rather than serving a cached build.
- `/` — 200, renders, featured listings populated, zero console errors.
- `/directory` — 200, all 6 cities with live counts (Encino 120, Sherman Oaks 152,
  Studio City 47, Tarzana 163, Toluca Lake 5, Valley Village 49 = 536).
- `/directory/tarzana` — 200, each listing shows the business's **own** number
  (360 Plumbing → (818) 970-6406, matching its CSLB record). Phone-boundary rule holds.
- `/admin/enrichment` — correctly redirects to Admin Login; auth gate holds.
- Network: every request 200/304, no failures. Console: no errors on any route.

**Database:**

- `supabase migration list` — `20260731120000` and `20260731130000` both applied
  (local == remote).
- `has_column_privilege('authenticated', …, 'UPDATE')` → true for all five review
  columns, **false** for `enriched_at`, as intended.
- RLS still guards the widened columns: as `authenticated` without admin claims, an
  UPDATE across the whole `needs_review` set changed **0 rows** (run in a rolled-back
  transaction). The grant opens the column; `is_admin()` remains the actual gate.
- `enrich-business-email` — ACTIVE, version 3.

## Current State

- Enrichment is **off** (`enabled: false`, `daily_limit: 20`).
- Queue: 13 verified · 15 needs_review · 30 processed-with-nothing-found · 478 unprocessed.
- The 15 needs_review rows predate `20260731120000`, so they have no
  `email_source_phone`/`email_source_address` and will show "none found" for both.
  They need re-enriching to populate, or can be judged on the phone as before.

## Rollback Procedure

Frontend (Vercel):
```bash
git revert e651188 e4fdde5 && git push origin main
```
Or promote the prior deployment (`6b448db`) in the Vercel dashboard for an instant
rollback without a rebuild.

Database — **order matters**; revoke before dropping columns:
```sql
REVOKE UPDATE (email, email_source_url, email_source_phone,
               email_source_address, email_confidence)
  ON public.businesses FROM authenticated;

ALTER TABLE public.businesses
  DROP COLUMN email_source_phone,
  DROP COLUMN email_source_address;
```

Edge function — redeploy the previous revision:
```bash
git checkout 6b448db -- supabase/functions/enrich-business-email supabase/functions/_shared/emailEnrichment.ts && supabase functions deploy enrich-business-email --project-ref lrqdbpphallqehpdqalr
```

**Caveat:** reverting the grant restores the original bug — Confirm and Dismiss stop
working. Prefer reverting only the frontend commit `e4fdde5` if the display is the
problem; the grant in `e651188` is a pure fix with no behavioral downside.
