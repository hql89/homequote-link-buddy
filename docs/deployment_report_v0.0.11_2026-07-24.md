# Deployment Report — Directory Engine

**Version:** 0.0.11 (unbumped — not released)
**Date:** 2026-07-24
**Environment:** Supabase production ✅ / Vercel frontend ❌ **NOT DEPLOYED**
**Branch:** `feat/directory-engine` (`dcc56b6`, `ba3bfa2`, `2e1628c`) — **not merged to `main`**

## Gate result: ⚠️ 5 of 6 pass — audit is the sole remaining blocker

Initial run failed four checks, all on pre-existing debt from the tree-service
pivot. Those were fixed in `2e1628c`. One check cannot be cleared without a
major framework migration.

| Check | Before | Now |
|---|---|---|
| Tests | ❌ 1 failed | ✅ **32/32 pass** |
| Build | ✅ | ✅ |
| Lint | ❌ 3 errors | ✅ **0 errors** |
| Type check | ❌ 26 errors | ✅ **0 errors** |
| drift / scan | ✅ | ✅ |
| npm audit | ❌ | ❌ **16 high / 1 critical — unresolvable without a major bump** |

### Why the audit cannot be cleared

`npm audit fix` (non-force) changes **nothing** — verified by dry run, the vuln
counts are identical afterwards.

The only advisory that reaches the **browser bundle** is
`react-router` / `react-router-dom` / `@remix-run/router` — *XSS via open
redirects*. The vulnerable range covers `react-router` `6.0.0 – 7.17.0`, so
there is no fix in the v6 line the app is on (`6.30.1`). Clearing it requires a
**React Router v6 → v7 major migration**, which would touch every route in the
app. `npm audit fix --force` would attempt that bump automatically and is very
likely to break routing.

The remaining highs — `glob`, `minimatch`, `brace-expansion`, `picomatch`,
`postcss`, `ws`, `lodash` — are build/tooling dependencies that are not shipped
to the browser. The 1 critical (CVSS 9.8) is the vitest UI server, **dev-only**.

**Recommendation:** treat the React Router upgrade as its own planned piece of
work, not a deploy-gate item.

## Bug found while clearing the gate

**Lead scoring was silently broken for the live business.**
`SERVICE_TYPE_SCORES` had no `tree_service` key, so `scoreServiceType()` fell
back to the plumbing map — whose keys never match a tree-service lead. Every
lead has been scoring **0** on the service-type component since the pivot.
Fixed, with keys verified against `VERTICALS.tree_service.serviceTypes`.

Also fixed: `/providers` still read **"Find a Plumber"** with plumbing meta
tags, and `LeadCaptureForm` defaulted to the non-existent `"plumbing"` vertical.

### Behaviour changes worth knowing

Fixing the admin-table types changed rendering slightly: booleans now show
Yes/No, empty values show an em dash, and an unparseable date shows an em dash
instead of "Invalid Date". Deleted `ServiceLanding.tsx` and `verticalContent.ts`
(zero references, confirmed absent from the production bundle).

The one-line `prefer-const` fix lives in
`supabase/functions/twilio-missed-call/index.ts`, which remains **uncommitted**
per your instruction to leave the Mivos/Twilio drift alone. Lint passes against
the working tree; if that file is ever committed the fix goes with it.

## What IS deployed

The **Supabase backend is live** — this happened before the gate ran, at your
direction:

- Both migrations applied to `lrqdbpphallqehpdqalr`
- 4 edge functions ACTIVE: `ingest-business`, `send-outreach-drip`,
  `claim-listing`, `submit-directory-lead`
- `trigger-retell-outbound-call` deleted (endpoint returns 404)

This backend is **inert without the frontend**: nothing links to
`/directory/:city/:slug`, and no business rows exist (both tables are empty).
No user-facing behaviour changed on the live site.

## Verification performed against production

Using temporary rows, since deleted:

- `businesses` / `directory_leads` → **401 to anon** (base tables closed)
- `public_business_listings` → **200**, exactly 12 columns; `claim_token`,
  `email`, and all Retell/consent columns absent
- `claim-listing` → resolves a valid token to masked data (`phone_last4`,
  `email_masked`); rejects a malformed token; completes a claim
- `submit-directory-lead` → rejects invalid phone, persists a valid lead
- Cleanup confirmed: both tables at 0 rows

## Not yet done

- [ ] `/directory` index route — listings reachable only by direct URL, absent from sitemap
- [ ] pg_cron schedule for `send-outreach-drip` (never fires until scheduled)
- [ ] `PUBLIC_SITE_URL` secret (Email 2 claim links fall back to `https://homequotelink.com`)
- [ ] `RESEND_API_KEY` (optional — SMTP alone works)
- [ ] Vercel env vars still point at the old, dead project ref — **the live site
      will break if redeployed before these are updated**

## Rollback

**Frontend:** nothing to roll back — never deployed. To abandon:
```bash
git branch -D feat/directory-engine
```

**Supabase backend:**
```bash
# remove the edge functions
for fn in ingest-business send-outreach-drip claim-listing submit-directory-lead; do
  supabase functions delete $fn --project-ref lrqdbpphallqehpdqalr
done
```
```sql
-- drop the schema (safe: both tables are empty)
DROP VIEW IF EXISTS public.public_business_listings;
DROP TABLE IF EXISTS public.directory_leads CASCADE;
DROP TABLE IF EXISTS public.businesses CASCADE;
DROP FUNCTION IF EXISTS public.set_businesses_updated_at();
```
Nothing pre-existing was modified, so rollback cannot affect leads, buyers,
posts, or any other existing table.

## To clear the gate

Smallest path to a passing gate, none of it blocked on this branch:

Items 1, 2 and 4 from the original list are **done** (`2e1628c`). What remains:

- **React Router v6 → v7 migration** — the only path to a clean `npm audit`.
  Plan it separately; it touches every route.

Until then the gate cannot report all-green, and merging to `main` is a
judgement call about accepting a known, pre-existing advisory that predates
this branch.
