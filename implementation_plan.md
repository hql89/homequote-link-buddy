# Implementation Plan — Directory Paid Tier (Upsell)

**Status:** Draft — awaiting approval
**Date:** 2026-07-25
**Replaces:** the Retell.ai "lease an AI agent" upsell (removed 2026-07-24, see [[homequote-blueprint-direction]])

## Why

The directory pipeline (ingest → auto-generated page → cold-email drip → claim) is live and gets a
business into the directory for free. The blueprint's next step — the actual monetization — was
Retell.ai voice-agent leasing, which was pulled out because it wasn't connected to this project.
Nothing replaced it. This plan defines that replacement: a paid listing tier with concrete,
non-AI features, sold as a monthly subscription via Stripe.

**Confirmed with user:** monthly subscription; no Stripe account exists yet (manual prerequisite);
feature direction is paid placement/features, not AI.

## A naming conflict to resolve first

This session shipped a **"Verified owner" badge** as a *free* trust signal — it appears on any
listing where `is_claimed = true`, specifically to reassure a business that claiming costs nothing
and isn't a paywall in disguise (see the trust-building work in `DirectoryListing.tsx`,
`ClaimListing.tsx`). The paid-tier feature list discussed ("verified badge, ranking, photos,
booking widget") can't reuse "verified" for the paid perk — that would contradict what claiming
currently means and risks looking like pay-to-play trust, the exact perception problem we just
spent this session avoiding.

**Proposal:** keep "Verified owner" exactly as-is (free, tied to `is_claimed`). The paid tier gets
a visually distinct label — "Featured" or "Premium" — never "Verified." Flagging this now for
sign-off before it's built into the schema and copy.

## Scope (this plan)

Two phases. Phase 1 has no external dependency and can ship standalone. Phase 2 is blocked on you
creating a Stripe account (account creation itself is not something I can do on your behalf).

### Phase 1 — Schema, gating, and static upsell surface (buildable now)

**Database migration** (new file under `supabase/migrations/`):
- `businesses.listing_tier` — `text`, `not null default 'free'`, `check (listing_tier in ('free','featured'))`
- `businesses.featured_until` — `timestamptz`, nullable — subscription period end; a cron-friendly
  expiry so a lapsed/canceled subscription silently reverts to `free` without a webhook race
- Index on `(city_slug, listing_tier)` since city listing pages will sort featured-first once a
  `/directory/:city` index exists (it doesn't yet — out of scope here, noted under Open Questions)
- No RLS change needed: both columns are readable through the existing `public_business_listings`
  view (add them to the view's column list), writes stay service-role-only

**Rollback:** `ALTER TABLE businesses DROP COLUMN listing_tier, DROP COLUMN featured_until;` — safe,
additive-only migration, no data transformation, nothing else reads these columns yet.

**Frontend — `src/pages/DirectoryListing.tsx`:**
- Featured listings get: an extra photo slot (schema already has no photo storage at all —
  see Open Questions), a "Featured" badge distinct from "Verified owner," and priority treatment
  once a city index page exists
- Free listings unaffected — current call-only/claimed behavior untouched

**Frontend — `src/pages/ClaimListing.tsx`:**
- Add a static "Upgrade to Featured" card after the lead-log card, describing the perks, with a
  disabled/"Coming soon" button — this is the upsell surface, wired to nothing yet in Phase 1
- No payment collection in Phase 1. Do not add a fake-functioning button — per the Development
  Critic Mindset, a dead button is exactly the kind of thing to flag, not ship

**Test strategy:**
- Unit test for the new `listing_tier` default and check constraint (migration test, matching the
  pattern already used for other directory-table constraints)
- Extend `directoryHelpers.test.ts` if any shared helper changes (e.g. a `isFeatured(business)` util)
- Manual verification: same pattern used this session — create a temp `featured` row via service
  role, screenshot the listing page, delete the row

**Acceptance criteria (Phase 1):**
- [ ] Migration applies cleanly against production schema, columns default correctly for all
      existing rows
- [ ] Free listings render identically to today — zero visual regression
- [ ] A `listing_tier = 'featured'` test row renders the Featured badge and does not show
      "Verified owner" language for the paid perk
- [ ] Claim page shows the upgrade card; button is visibly disabled, not a dead-looking active button
- [ ] All existing tests still pass; new tests cover the tier default/constraint

### Phase 2 — Stripe checkout + webhook (blocked on your Stripe account)

Not started until Phase 1 ships and you've created the Stripe account. Sketch, for sign-off now so
Phase 1's schema doesn't need revisiting:

- New edge function `create-checkout-session` — authenticated by claim token (same bearer model as
  `claim-listing`), creates a Stripe Checkout session for the monthly Featured price
- New edge function `stripe-webhook` — handles `checkout.session.completed` (set `listing_tier =
  'featured'`, `featured_until` = period end) and `customer.subscription.deleted` /
  `invoice.payment_failed` (revert to `free`)
- Stripe Customer Portal link (not a custom billing UI) for cancel/update-card, linked from the
  claimed listing's post-claim view — reuse Stripe's own portal rather than building one
  (Component Reuse First)
- Secrets required: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_FEATURED_PRICE_ID` — all
  as Supabase edge function secrets, never in source

**Rollback (Phase 2):** delete the two edge functions; `listing_tier` rows simply stop updating and
existing featured rows expire naturally via `featured_until` — no destructive rollback needed.

## Open questions — resolved 2026-07-25

1. **Photos → deferred.** No photo storage exists anywhere in the schema; it needs its own
   storage-bucket design. Not part of Phase 1, and therefore not part of the Featured perk list
   until that follow-up plan happens.
2. **Booking widget → simplest option.** A "preferred time" form field, not a calendar
   integration. `directory_leads.preferred_time` already exists and `submit-directory-lead`
   already accepts, stores, and emails it — only the form doesn't render it. So this perk is
   pure frontend gating over plumbing that already works end to end.
3. **`/directory` city index → build it.** Included in Phase 1, since featured-first ranking is
   meaningless without a page to rank within. Also closes an item flagged in the earlier
   deployment report.
4. **Price point → deferred to Phase 2** (needed only when the Stripe price object is created).

### Revised Featured perk list (Phase 1)

Given the above, Featured = **priority placement on the city index** + **a Featured badge** +
**the preferred-time field on the quote form**. Photos and any real booking integration are
explicitly out until their own plans exist. This is a deliberately thin first tier — enough to
have something real to sell, not enough to over-promise.

## Files touched (Phase 1)

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | add `listing_tier`, `featured_until`; extend `public_business_listings` view |
| `src/pages/DirectoryListing.tsx` | Featured badge, gated photo/priority treatment |
| `src/pages/ClaimListing.tsx` | static upgrade card (disabled CTA) |
| `src/integrations/supabase/directory.ts` | add `listing_tier`/`featured_until` to `PublicBusinessListing` / `ClaimBusiness` types |
| `tests/unit/directoryHelpers.test.ts` | tier-related test coverage if a shared helper is added |
| `docs/architecture/DECISIONS.md` | new ADR recording the Retell.ai → paid-tier upsell pivot |
