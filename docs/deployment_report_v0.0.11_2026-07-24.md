# Deployment Report — Directory Engine

**Version:** 0.0.11 (unbumped — not released)
**Date:** 2026-07-24
**Environment:** Supabase production ✅ / Vercel frontend ❌ **NOT DEPLOYED**
**Branch:** `feat/directory-engine` (commit `dcc56b6`) — **not merged to `main`**

## Gate result: ❌ FAILED — frontend deploy halted

The `/deploy` gate requires all five pre-deploy checks to pass. Four failed, so
the frontend was **not** pushed to `main` and Vercel was not triggered.

| Check | Result | Mine? |
|---|---|---|
| Tests | ❌ 1 failed / 32 | **No** — pre-existing |
| Build | ✅ succeeds | — |
| Lint | ❌ 3 errors | **No** — pre-existing |
| npm audit | ❌ 11 high (prod), 1 critical (dev-only) | **No** — pre-existing |
| Type check | ❌ 26 error lines | **No** — pre-existing |

**Every failure predates this work.** Verified: typecheck error count is
identical to the HEAD baseline (26 lines), and 0 errors are in new files.

### Failure detail

1. **Test — `Index.test.tsx > renders the hero heading correctly`**
   Asserts `/Santa Clarita Home Service Directory/i`, but the Sherman Oaks
   pivot (`db2bb2b`) changed that hero. The test was written in `eb2a2ac` and
   never updated when the pivot landed. Neither `Index.tsx` nor its test is
   touched by this branch.

2. **Lint — 3 errors**
   - `tests/unit/Index.test.tsx` (×2) — `no-explicit-any`, same pivot-era file
   - `supabase/functions/twilio-missed-call/index.ts` — `prefer-const`, in the
     uncommitted Mivos/Twilio drift that was deliberately left alone

3. **npm audit — 11 high in production deps**
   The 1 critical (CVSS 9.8, vitest UI server arbitrary file read) is
   **dev-only** and does not ship. The production highs are transitive
   (`ws`, `yaml`, others). `npm audit fix` claims a fix is available.

4. **Type check — 26 error lines**
   Mostly leftover `plumbing` references from the tree-service pivot
   (`verticalContent.ts`, `leadScoringService.ts`, `LeadCaptureForm.tsx`) plus
   admin table generics. `npm run build` still succeeds because Vite does not
   typecheck.

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

1. Update `Index.test.tsx` to assert the current Sherman Oaks hero (or delete
   the stale assertion) — fixes 1 test + 2 lint errors
2. `prefer-const` in `twilio-missed-call/index.ts` — 1 lint error
3. `npm audit fix` — review the diff, then re-run
4. Work through the 26 pivot-era type errors

Items 1–3 are quick. Item 4 is the real debt.
