# Critic Report — Valley Home Pros Directory Pivot (Phase 1)

**Date:** 2026-07-25
**Verdict:** No blockers remaining. Everything below was found and fixed during the pass.

## Blockers found and fixed

### 1. Crash in the final step of the lead form (would have shipped)
`ContactStep` read `VERTICALS[vertical].label` directly. That map contains only
`tree_service`, so the moment the homepage began offering DB-backed categories, selecting
Plumbing/HVAC/Landscaping/Electrical made the lookup `undefined` and `.label` threw —
killing step 3 of 3, *after* the user had filled in everything else.

Fixed with the safe `getVertical()` accessor plus an explicit `categoryLabel`. Locked by
`tests/unit/ContactStepVertical.test.tsx` (4 tests).

### 2. Wrong service options per category (fake functionality)
`ServiceStep` derived its options from the same hardcoded map, so a homeowner selecting
"Plumbing" would have been offered *Stump Grinding* and *Palm Tree Skinning*. The
`verticals` table already stores correct `service_types` per category; those are now
threaded through. **Verified in the running app:** clicking Plumbing yields General
Plumbing, Drain Cleaning, Water Heater, Leak Detection, Sewer Line, Repiping, Fixture
Installation, Emergency Plumbing.

### 3. ZIP → city autofill silently dead for every Valley homeowner
`zipCityMap.ts` contained only Santa Clarita Valley ZIPs (91350–91390, 91321–91322). Since
`cityFromZip` returns `null` on a miss and the caller only autofills on a hit, every San
Fernando Valley resident typing a real ZIP got nothing, with no error. Replaced with SFV
ZIPs for all six covered cities.

### 4. Five live 404s in site navigation
Header "Pricing" → `/cost-guides`, and Footer → `/services/hvac`, `/services/landscaping`,
`/services/electrical`, `/plumbers`. None of these routes exist in `App.tsx`. All were
live in production. Nav rebuilt around routes that resolve; a test now asserts the two
worst offenders can never return.

### 5. Dead conditional in the lead form
`LocationStep` compared city against `"Other / Outside SCV"` while `SFV_CITIES` offers
`"Other / Outside SFV"` — the out-of-area notice could never render.

### 6. Two more dead-project references (same class as yesterday's cron bug)
`index.html` pointed its **sitemap** and **RSS feed** at `cjdhbiuhzrpruqbbnnqz` — the
retired Supabase project. Search engines and feed readers were being sent to a project
that no longer exists. Also a wasted `preconnect` to the same dead host. Repointed.

### 7. The FAQ described us as the thing we promise contractors we are not
The "For Buyers" section read: *"a residential plumbing lead generation service… you pay
for exclusive leads."* Any contractor doing diligence before claiming a listing would have
found us advertising lead brokerage while the listing page promised the opposite. Rewritten
as "For Business Owners", answering the actual objections (Do you sell my leads? Whose
number is on my listing? How did my business get here?).

### 8. Legal pages described a different company
Terms called the site *"a lead referral service… with local plumbing professionals"* in the
*"Santa Clarita Valley"* — wrong brand, region, vertical, and business model. Privacy had
the same. Both corrected to describe the directory that actually exists.

## Verified working (not just compiled)

- Homepage renders all five categories from `verticals`, not the hardcoded map
- Category click → form re-keys and swaps service options (proven in browser, above)
- Matching form still writes to **`leads`** (`useLeadFormSubmit` → `.from("leads")`),
  keeping scoring/routing intact — per-business forms still write `directory_leads`
- **Phone boundary, end-to-end:** on a real listing page the only `tel:` link is the
  business's own number; the hotline is absent; header is wordmark-only; and the
  "no tracking number, no middleman" copy is therefore true
- Empty states: Featured section hides entirely at zero rows; cities fall back to a
  static non-linked list rather than linking to empty pages
- Zero console errors on the homepage
- 51 tests, 0 lint errors, 0 type errors, build succeeds

## Known-remaining, deliberately out of Phase 1

| Item | Why deferred |
|---|---|
| `/services/*` pages still single-business framed with a direct call CTA | Phase 3 of the plan — needs `vercel.json` 301s to `/directory/tree-service/*` to preserve ranking |
| `/providers`, `/provider/*` marketplace pages | Backed by an empty `buyers` table; unlinked from nav now, but not removed |
| `businesses` has no `vertical` column | Phase 2 — listings can't be filtered by category yet; the homepage category cards route to matching, not to category pages |
| `emailTemplates.ts` sample data says "Santa Clarita" | Preview/sample values only, not sent copy |
| `StickyMobileCTA` now has zero references | Orphaned by the homepage rewrite; left in place rather than deleted unprompted |
| Directory is empty (0 businesses) | Phase 4 — seeding is a data task; outreach shouldn't start before it |
