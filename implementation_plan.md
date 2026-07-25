# Implementation Plan — "Valley Home Pros" Directory Pivot

**Status:** Draft — awaiting approval
**Date:** 2026-07-25
**Supersedes:** the single-niche Sherman Oaks tree-service homepage
**Related:** [docs/plans/directory-paid-tier.md](docs/plans/directory-paid-tier.md) (Phase 1 shipped; Stripe phase still pending)

## Why

The live homepage is a single-business tree-service landing page ("Expert Tree Service &
Removal in Sherman Oaks") with its own phone CTA, sitting one click from other contractors'
listings. That is the exact brand-hijacking pattern the hybrid model exists to eliminate: a
contractor who visits sees us competing for the same call.

This pivots the site into a regional directory portal under a single master brand, with
per-business listing pages that route exclusively to their owner.

**Timing is favorable:** `businesses`, `buyers`, and `reviews` are all **0 rows**; only 6 test
leads exist. There is no live funnel to break. This is the cheapest possible moment to do this.

---

## ⚠️ Two conflicts with work already shipped — read before approving

### Conflict 1: CallRail tracking numbers vs. the trust copy now in production

Last session, to solve *"businesses will think we're trying to steal their leads,"* the following
copy shipped to production and is live on every claimed listing:

> **"Calls go directly to {Business} — no tracking number, no middleman."**

and on the claim page:

> **"Calls already go to your number directly."**

The answer above specifies **CallRail dynamic number swapping on individual listing pages**. A
tracking number is, precisely, a middleman number — so shipping that would make live copy false,
and would reintroduce the exact fear the copy was written to defuse. A contractor who discovers
the number on "their" page is ours, after reading that line, is a contractor lost permanently.

**Proposed resolution — split by who owns the page.** This preserves *both* plays without lying:

| Page | Number shown | Rationale |
|---|---|---|
| `/directory/:city/:slug` (a business's own listing) | **Their real number.** Copy stays as-is. | Their page, their traffic. This is the trust asset. |
| `/directory/tree-service/palm-tree-trimming` (our SEO guides) | **Tracking number.** | Our content, our rankings, our traffic — tracking is entirely legitimate. |
| Homepage / category / city index | **Valley hotline.** | Ours. |

This is also a *stronger* leasing pitch: "here are the calls **our** page generated last month,
want them routed to your cell for $297/mo" is cleaner than tracking calls on a page we gave them
for free. The leasing play lives on our SEO pages — which is where the answer above already
places it (Step 3).

**Override me if you disagree** — but if tracking goes on business listing pages, the trust copy
must be rewritten in the same change. I will not leave a claim in production that the
implementation contradicts.

### Conflict 2: Retell.ai is not connected to this project

The hotline is described as answered by a **Retell.ai voice agent**. Retell was deliberately
removed on 2026-07-24 (`20260724150000_remove_retell_integration.sql`) after you confirmed it
wasn't plugged in, along with the TCPA consent capture that existed only to authorise it.

Nothing in this plan re-adds Retell. The hotline is built as a **plain phone number** that works
today. If/when a Retell account exists, the number can point at it with no frontend change — the
page never knows what answers the call. Flagging so the plan isn't read as delivering an AI
receptionist it does not deliver.

---

## Good news found while scoping

**The extra verticals already exist.** `public.verticals` already holds fully-configured rows for
Plumbing, HVAC/AC, Yard & Landscaping, and Electrical — hero titles, meta, service type lists,
professional labels — all sitting at `is_active = false`. Only `tree-service` is active.

**And the homepage already fetches them and throws the result away.** [Index.tsx:37](src/pages/Index.tsx:37)
calls `useActiveVerticals()`, then renders the dropdown from the hardcoded `VERTICALS` object in
[constants.ts:7](src/lib/constants.ts:7) which contains only `tree_service`. That is why the footer
advertises Plumbing/HVAC/Landscaping/Electrical while the form can't select them — a live bug this
pivot fixes for free.

Caveat: their copy says **"Santa Clarita"** (pre-SFV-pivot leftover) and needs rewriting for the
Valley. Pest Control and Mold/Water Mitigation are not present and are new rows.

---

## Scope

### Phase 1 — Master brand + directory homepage

**Brand (`src/lib/constants.ts`):**
- `SITE_NAME`: `"Sherman Oaks Home Pros"` → `"Valley Home Pros"`
- Retire the `HomeQuoteLink` wordmark from the header (domain is unaffected — brand ≠ domain)
- Add `SITE_REGION = "San Fernando Valley"` for reuse in copy
- Nested page-title helper so titles read `Sherman Oaks Home Pros | Valley Home Pros`,
  `{Business} — {City} Tree Service | Valley Home Pros`

**New homepage (`src/pages/Index.tsx`, full rewrite):**
- Local search bar (service + city)
- Service category grid, rendered from **active DB verticals** (fixes the dead-code bug)
- **Featured businesses** strip — reuses `tier_rank` ordering from the paid tier already shipped,
  so Featured listings surface on the homepage automatically
- Community-matching form: *"Need work done in the Valley? Tell us your project and we'll match
  you with a local specialist."* → writes to the existing **`leads`** table (not
  `directory_leads`), preserving the scoring/routing/buyer machinery and making the
  "hand a contractor a free live lead" hook executable
- Cities served → links to `/directory/:city`

**Header (`src/components/public/Header.tsx`):**
- Replace the boolean `minimal` prop with a `variant` of `portal | listing`:
  - `portal` (home, category, city index): Valley hotline + directory nav
  - `listing` (a business's page): no site phone at all — unchanged from what shipped last session
- Retire the `Providers`/`Pricing` marketplace nav in favor of directory nav

**Tests:** title-builder helper, vertical-to-category mapping, matching-form submission target
(`leads` not `directory_leads`), header variant rendering.

### Phase 2 — Category expansion

- Activate Plumbing, HVAC, Landscaping, Electrical (`is_active = true`)
- Rewrite their hero/meta copy from Santa Clarita → San Fernando Valley
- Add **Pest Control** and **Mold / Water Mitigation** rows
- `/directory/category/:slug` pages listing businesses in that vertical
- Migration + rollback: `is_active` flips are trivially reversible; new rows are deletable

**Note:** `businesses` has no `vertical` column. Categorising listings needs one (or a join
table). This is real schema work, not a config flip — the only genuinely new modelling in Phase 2.

### Phase 3 — SEO page migration

- Move `/services/emergency-tree-removal` → `/directory/tree-service/emergency-tree-removal`
  (same for brush-clearing, palm-tree-trimming)
- **301s via `vercel.json`**, not React Router. `vercel.json` currently has only a catch-all
  rewrite; a `redirects` array must be added *above* it (Vercel evaluates redirects before
  rewrites). A React Router `<Navigate>` is client-side and passes **no** ranking signal — using
  one here would silently discard the SEO equity this phase exists to preserve.
- CTA reframe: hotline + "browse local specialists below", per the answer above
- Keep content identical so rankings transfer

### Phase 4 — Seed the directory

An empty directory undermines the outreach pitch ("I added your business to my Valley directory"
→ they click → nothing there). `ingest-business` already exists; this is a data task, not a build
task. Baseline public listings across all categories, outbound focused on tree service only.

---

## Acceptance criteria (Phase 1)

- [ ] No page presents the site as a single tree-service business
- [ ] Homepage renders categories from active DB verticals; no hardcoded single-vertical list
- [ ] Featured (paid-tier) businesses surface above free ones on the homepage
- [ ] Matching form writes to `leads`; per-business forms still write to `directory_leads`
- [ ] A business listing page shows **no** site-wide phone — only that business's
- [ ] "no tracking number, no middleman" copy remains **true** everywhere it appears
- [ ] Zero lint/type/test failures; build succeeds
- [ ] Empty states are graceful (directory is currently 0 rows)

## Rollback

Frontend-only for Phase 1 — revert the commit and Vercel redeploys. No schema change in Phase 1.
Phase 2 rollback: flip `is_active` back to false, drop new rows/column. Phase 3 rollback: remove
the `redirects` block from `vercel.json`.

## Open decisions

1. **Tracking numbers on business listing pages** — Conflict 1 above. Recommend: no.
2. **Retell** — build hotline as a plain number now? (Recommend: yes.)
3. **Wordmark** — confirm the header should read "Valley Home Pros" and drop "HomeQuoteLink"
   entirely, given the domain stays `homequotelink.com`.
