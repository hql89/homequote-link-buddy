# Deployment Report — Directory Paid Tier + Bug Fixes

**Version:** 0.0.12
**Date:** 2026-07-25
**Environment:** Production ✅
**Branch:** `main` (commits `95ee97a` through `17857b5`)

## Summary

Shipped the directory paid-tier feature (Phase 1 of implementation plan) and fixed two separate production bugs discovered in the process.

## Changes Deployed

### 1. Directory Paid Tier (3 commits, `95ee97a`..`8cfd27b`)

**Features:**
- `/directory` index and `/directory/:city` pages now exist (was flagged as missing in v0.0.11 report)
- Directory listings sorted by tier: Featured (paid) above Free on city pages
- Featured badge (distinct from free "Verified owner" badge) with amber styling
- "Best time to reach you" field on quote form, gated to Featured tier
- Upgrade card on claim page with disabled "Coming soon" CTA (Phase 2 Stripe awaits user account creation)

**Schema (additive, rollback documented):**
- `businesses.listing_tier` (enum: 'free'|'featured', CHECK constraint)
- `businesses.featured_until` (timestamptz for subscription expiry)
- `tier_rank` sort key (explicit, not relying on alphabetical ordering of tier names)
- `public_business_listings` view resolves expiry; effective tier is single source of truth
- `public_directory_cities` aggregate view (SELECT DISTINCT workaround for PostgREST)

**Tests:** 40 passing (added 3 new: `isFeatured()`, `formatPhoneDisplay()`, `toTelHref()`)
**Bug fixes during implementation:**
- Extracted phone formatting helpers into shared module (were private duplicates in DirectoryListing)
- Applied formatting to directory-city cards and owner's lead log (E.164 raw refs were rendering)

**Why Phase 1 without Stripe:**
The blueprint's only upsell was Retell.ai (removed 2026-07-24). This rebuilds the monetization path with perks that exist today, not aspirational ones. Phase 2 (Stripe checkout + webhook) is blocked on user creating a Stripe account.

### 2. Cron Admin Function Bug Fix (1 commit, `1ca95d5`)

**Bug:** `admin_toggle_cron_job` (System Status page) hardcoded two jobs to a dead Supabase project (cjdhbiuhzrpruqbbnnqz, end-of-life since tree-service pivot to lrqdbpphallqehpdqalr).
- `publish-scheduled-posts` 
- `send-nurture-emails-hourly`

Any admin enabling either would get a success response while the internal HTTP call silently failed forever.

**Fix:** Repointed both to current project. Added `send-outreach-drip-daily` as a recognized job name (no schedule, by design — enabling autonomous cold email is a deliberate choice, not a side effect of a bug fix).

**Verification:** Confirmed old ref no longer appears anywhere in the function body, current ref appears 3× (once per job). `pg_cron` remains uninstalled — intentional, not an oversight.

### 3. Documentation Update (1 commit, `17857b5`)

Corrected stale items in v0.0.11 deployment report:
- `/directory` now done (not a blocker)
- Vercel env-var warning already stale (live site has been reading correct project all along)
- Outreach-drip cron left off on purpose (not forgotten)

## Verification

| Check | Result |
|-------|--------|
| Tests (npm test) | ✅ 40 pass, 0 fail |
| Build (npm run build) | ✅ Succeeds, dist/ ready |
| Lint (npm run lint) | ✅ 0 errors |
| Type check (npx tsc) | ✅ 0 errors |
| npm audit | ⚠️ 14 vulnerabilities (pre-existing; react-router v6→v7 blocker deferred) |
| Smoke test | ✅ Homepage, directory index, 404 page all render; no console errors; network: 200/304 only |

## Database Migrations Applied

Two migrations pushed to production:

1. **`20260725120000_directory_paid_tier.sql`** — Schema for listing tiers, expiry, sorting
   - Additive only
   - Rollback: drop columns and recreate view from v0.0.11
   - Verified: expired featured_until reads as free in the view; old project ref found nowhere

2. **`20260725150000_fix_cron_admin_toggle_project_ref.sql`** — Corrected dead project refs in admin function
   - Additive only (just replaces the function)
   - No scheduling or enablement side effects
   - Verified against production after apply

## Breaking Changes

None. All changes are additive or bug fixes.

## Rollback Procedure

**Frontend:** Revert to prior commit on `main` and push; Vercel auto-deploys.

**Database:**
```sql
-- Undo paid tier schema
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_listing_tier_check,
  DROP COLUMN IF EXISTS listing_tier,
  DROP COLUMN IF EXISTS featured_until;

DROP INDEX IF EXISTS public.businesses_city_tier_idx;

-- Restore public_business_listings view from v0.0.11 snapshot
DROP VIEW IF EXISTS public.public_business_listings;
CREATE VIEW public.public_business_listings AS
SELECT
  id, business_name, slug, city, city_slug, owner_name, phone,
  website_url, services, scraped_context, is_claimed, created_at
FROM public.businesses
WHERE is_published = TRUE;

GRANT SELECT ON public.public_business_listings TO anon, authenticated;

-- Cron function revert: re-run the function body from 
-- 20260429151343_8a02cb60-f1e1-4819-bbc0-1930f15ec3f6.sql
-- (or any prior version with the desired behavior)
```

## Known Open Items

From v0.0.11 deployment report (unchanged):
- **Phase 2 of paid tier** (Stripe integration) — blocked on user creating Stripe account
- **`send-outreach-drip` cron scheduling** — `pg_cron` not enabled; deliberately left off (autonomous cold email is a user decision)
- **`PUBLIC_SITE_URL` secret** — low priority, hardcoded fallback (`https://homequotelink.com`) already matches production
- **`RESEND_API_KEY` secret** — optional, SMTP alone works

## Edge Functions Status

All 25 edge functions in repo pass `deno check` clean.

Current functions:
- `claim-listing` — updated to return listing tier
- `submit-directory-lead` — unchanged (no tier gating on lead submission itself)
- All others — unchanged

## Next Steps

1. **To enable Featured tier sales:** Create Stripe account + decide monthly price → implement Phase 2 (checkout + webhook)
2. **To enable cold-outreach drip:** Call `admin_toggle_cron_job('send-outreach-drip-daily', true)` from System Status page
3. **React Router v6→v7 migration:** Separate planned work; currently deferred
