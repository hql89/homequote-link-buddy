# Deployment Report — Valley Home Pros Directory Pivot

**Version:** 0.0.13
**Date:** 2026-07-25
**Environment:** Production ✅
**Commit deployed:** `d59d449` (pivot shipped in `174865b`)
**Supabase project:** `lrqdbpphallqehpdqalr`

## Gate result: 4 of 5 pass — audit is the sole exception, unchanged and accepted

| Check | Result |
|---|---|
| Tests | ✅ **51 passed** (8 files, 0 failed) |
| Build | ✅ succeeds |
| Lint | ✅ 0 errors |
| Type check | ✅ 0 errors |
| npm audit | ⚠️ 16 high / 1 critical — **pre-existing, not a regression** |

### Audit triage

Only three advisories reach the browser bundle: `react-router`, `react-router-dom`,
`@remix-run/router` (XSS via open redirects). The vulnerable range covers `6.0.0–7.17.0`,
so **there is no fix in the v6 line this app runs**. Clearing it requires the v6→v7
migration tracked as separate planned work.

Everything else is build/dev tooling that never ships: the lone **critical** is `vitest`,
plus `vite`, `rollup`, `postcss`, `ws`, `lodash`, `glob`, `minimatch`, `brace-expansion`,
`picomatch`, `js-yaml`, `flatted`, `form-data`, `linkify-it`.

Unchanged across the last four deploys. Accepted per the standing decision in the v0.0.11
report.

## Changes Deployed

### The pivot (`174865b`)
The homepage was a single-business tree-service landing page ("Expert Tree Service &
Removal in Sherman Oaks") with its own phone CTA, one click from other contractors'
listings — the brand-hijacking pattern the directory model exists to eliminate.

- **Master brand** — "Sherman Oaks Home Pros" / "HomeQuoteLink" → **Valley Home Pros**.
  Page titles nest under it (`{Business} — {City} Home Services | Valley Home Pros`).
  Domain unchanged.
- **Phone boundary made structural** — `Header` takes `portal | listing`. Portal pages
  carry the Valley hotline; a business's listing/claim page carries no site phone and no
  nav.
- **Homepage rebuilt as a portal** — category grid, featured businesses (reusing the paid
  tier's `tier_rank`), community-matching form, cities. Matching form writes to `leads`;
  per-business forms still write `directory_leads`.
- **Categories now DB-driven** — Plumbing, HVAC, Landscaping, Electrical activated in
  `verticals` (they already existed fully configured at `is_active = false`), with their
  Santa Clarita / HomeQuoteLink copy corrected.
- **FAQ, Terms, Privacy rewritten** — they described "a residential plumbing lead
  generation service" selling "exclusive leads" in the Santa Clarita Valley.

### Ten defects fixed (detail in `docs/bugs.md`)
Two would have shipped, caught in the critic pass:
- `ContactStep` read `VERTICALS[vertical].label` → `undefined` for every DB-backed
  category → **crash on step 3 of 3**, after the user filled everything in.
- `ServiceStep` offered tree-service options regardless of category ("Plumbing" → Stump
  Grinding).

Also: ZIP→city autofill silently dead for every Valley homeowner (map held only Santa
Clarita ZIPs); five live 404s in nav; a dead `LocationStep` branch comparing "Outside SCV"
against SFV options; `index.html` sitemap + RSS pointing at the retired project.

### Docs (`d59d449`)
`docs/knowledge.md`, `docs/bugs.md`, `critic_report.md`.

## Verification

**Pre-deploy:** 51 tests, 0 lint, 0 type errors, build clean.

**Post-deploy smoke test — against production, not localhost:**
- Homepage: title/brand correct, all 5 categories render, old tree headline gone, zero
  dead nav links, matching form present
- **Category → form flow:** clicked HVAC → options became *AC Repair, Furnace Repair, Duct
  Cleaning, Heat Pump…* with **no tree-service leakage**
- `/directory`: renders with correct nested title and graceful empty state
- `/faq`: broker language gone, "For Business Owners" section live
- **Phone boundary on a real listing:** exactly one `tel:` link (the business's own),
  hotline absent, header stripped to wordmark, "no tracking number, no middleman" copy
  therefore true
- **Unclaimed-listing gate:** direct API call rejected — *"This business hasn't set up
  quote requests yet"* — and **0 leads written**
- Console: no errors. Network: all 200/304, no failures
- Migrations: 43 total, **0 pending**

Test data created for these checks was deleted; `businesses` and `directory_leads` both
back to **0 rows**.

## Breaking Changes

None functional. Visible changes worth knowing:
- Site brand and all page titles changed (SEO will re-index)
- `og:site_name`, JSON-LD Organization/LocalBusiness/WebSite renamed and re-regioned
- Header nav: "Providers" and "Pricing" removed (the latter was a 404), "Directory" added
- `Header`'s `minimal` prop replaced by `variant` — all five call sites updated

## Rollback

**Frontend:** revert and push; Vercel redeploys automatically.
```bash
git revert 174865b d59d449 && git push origin main
```

**Verticals migration** (`20260725180000`) — reversible; copy corrections are cosmetic and
safe to leave:
```sql
UPDATE public.verticals SET is_active = FALSE
 WHERE slug IN ('plumbing','hvac','landscaping','electrical');
```

**Paid tier** (`20260725120000`) and **cron fix** (`20260725150000`) rollback SQL is in each
migration header. Note the pivot's frontend does not depend on the cron fix.

## Open Items

- **Directory is empty (0 businesses)** — gates outreach; the cold email says "I added your
  business," and a click-through to an empty directory undoes the pitch
- Stripe Phase 2 — blocked on account creation + price decision
- `businesses` has no `vertical` column, so category pages can't filter yet
- `/services/*` still single-business framed; needs `vercel.json` 301s to
  `/directory/tree-service/*` (React Router `<Navigate>` passes no ranking signal)
- `pg_cron` not installed; outreach drip deliberately unscheduled
- `PUBLIC_SITE_URL`, `RESEND_API_KEY` unset (both low priority)
- React Router v6→v7 migration — the only path to a clean audit
