# Deployment Report — Business Ingestion Engine

**Version:** 0.0.14
**Date:** 2026-07-26
**Environment:** Production ✅
**Commit deployed:** `fcb0f59`
**Supabase project:** `lrqdbpphallqehpdqalr`

## Changes Deployed

### Core feature: Business ingestion engine (Phase 1)
- **CSLB source** — California Contractors State License Board database. Free, authoritative, legal to store, includes license status (backs up "Licensed & Insured" claim). Better than Google Maps (ToS violation) or Places API (forbids retention >30 days).
- **Staged queue pattern** — Browser parses CSLB CSV (statewide file too large for edge functions), rows stage in `ingest_queue`, worker drains at admin-configurable rate (default 25/day). Source-agnostic; any CSV feeds the pipe.
- **Silent ingestion** — Rows created unpublished, outreach paused, no email sent. Publishing and outreach are separate explicit actions. Protects domain reputation when crawling at volume.
- **Admin Ingestion page** — Upload CSV, watch queue status, "Run now" button, review table with publish/preview actions. Rate adjustable without deploy.
- **Two edge functions**
  - `import-ingest-queue`: server-side re-validation of browser-parsed candidates
  - `process-ingest-queue`: rate-limited daily worker
- **Capability-based auth helper** — Replaces fragile string-matching of env vars. Tests privilege by hitting RLS-protected table; survives key rotations.
- **Perplexity settings UI** — Write-only API key storage (never sent to browser; shows masked hint). Ready for Phase 2 enrichment.

### Supporting infrastructure
- `ingest_queue` table (staging area for candidates)
- `ingest_config` admin setting (daily limit, enabled flag, cities)
- License-related columns on `businesses` table (license_number, license_status, license_expires_at, source)

### Documentation
- `docs/knowledge.md` (updated): CSLB source, staged queue pattern, silent ingestion principle, capability-based auth
- `docs/bugs.md`: Ten bugs fixed (two would have shipped; eight prevented future issues)
- `critic_report.md`: Critic pass findings from Phase 1

## Gate result: 5 of 5 pass

| Check | Result |
|---|---|
| Tests | ✅ **78 passed** (10 files) |
| Build | ✅ succeeds |
| Lint | ✅ 0 errors |
| Type check | ✅ 0 errors |
| npm audit | ⚠️ 24 vulnerabilities (pre-existing, not regressions) |

### Audit triage
Three high-severity advisories reach the browser bundle: `react-router`, `react-router-dom`, `@remix-run/router` (XSS via open redirects covering `6.0.0–7.17.0`). No fix in v6 line; requires v6→v7 migration (tracked separately). Everything else is build/dev tooling that never ships: 16 other high, 1 critical (`vitest`). Unchanged across four consecutive deployments. Not a blocker per standing decision in v0.0.11.

## Verification

**Pre-deploy** — 78 tests, 0 lint, 0 type errors, build clean.

**End-to-end smoke test against production** (not localhost):
- Ingestion flow: uploaded 3 candidates; 1 rejected server-side (wrong city); re-imported same file (0 new rows inserted, 2 duplicates — idempotency ✅)
- Worker run: 2 rows ingested, unpublished, outreach paused, no email sent
- **Silent ingestion guarantee**: Every row landed `is_published = FALSE`, `outreach_paused = TRUE`, `outreach_email_1_sent_at = NULL` — verified against database
- **Idempotency**: Re-run on same queue → 0 ingested, 0 duplicates (row dedup works ✅)
- **Public invisibility**: Unpublished rows absent from `public_business_listings` and `public_directory_cities` views ✅
- **Auth boundary**: anon caller → 403 on both endpoints ✅; no auth → 401 ✅
- Test data cleaned up; `businesses` and `ingest_queue` back to 0 rows

## Bugs Found & Fixed

**Two would have shipped; caught in critic pass:**
- `ON CONFLICT (license_number)` rejected on `ingest_queue` — partial unique index can't be conflict target without repeating predicate (PostgREST limitation). Switched to plain index.
- Auth hole: RLS filters rows, doesn't raise errors — `isPrivilegedCaller` tested `!error`; anon got 200 with empty set and passed. Fixed to require rows back.

**Pre-existing discovery:**
- `ingest-business` env key is stale — function string-compares `SUPABASE_SERVICE_ROLE_KEY`, which no longer equals actual project key. Silently rejects documented auth method. Flagged for separate fix.

## Open Items

- **Directory is empty (0 businesses)** — gates outreach; need real CSLB import to seed
- **Phase 2 email enrichment** blocked on Perplexity key provisioning + website-discovery step (CSLB has no website field)
- **pg_cron not installed** — worker runs via "Run now" button only; deliberate (keeps outreach human-gated until ready for autonomous)
- `ingest-business` broken auth and `ai-company-lookup` fabricates facts — separate tasks

## Rollback

**Frontend**: revert and push; Vercel redeploys automatically.
```bash
git revert fcb0f59 && git push origin main
```

**Migrations** — reversible; both have full rollback SQL in headers:
- `20260726090000_ingest_engine.sql`: drop `ingest_queue` table, drop 4 columns from `businesses`, delete config row
- `20260726100000_fix_ingest_queue_conflict_target.sql`: restore partial index

**Edge functions**: revert and redeploy, or toggle off via Supabase dashboard.
