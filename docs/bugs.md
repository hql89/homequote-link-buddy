# Resolved Bugs

Newest first. Root causes, not just symptoms.

---

## Lead form crashed on any non-tree category — 2026-07-25
**Symptom**: Would have thrown on step 3 of 3 (the contact/consent step) for Plumbing,
HVAC, Landscaping or Electrical — after the user had already filled in everything.
Caught in the critic pass before shipping.
**Root Cause**: `ContactStep` read `VERTICALS[vertical].label`. `VERTICALS` contains only
`tree_service`, so the lookup was `undefined` and `.label` threw. Dormant until the
homepage began offering DB-backed categories, which armed it.
**Fix**: Use `getVertical()` (has a safe fallback) plus an explicit `categoryLabel` prop
threaded from the caller.
**Prevention**: `tests/unit/ContactStepVertical.test.tsx` — 4 tests, including an unknown
vertical.

---

## "Plumbing" offered Stump Grinding — 2026-07-25
**Symptom**: Service options didn't match the selected category.
**Root Cause**: `ServiceStep` called `getServiceTypes(vertical)`, which falls back to the
hardcoded tree-service list for anything not in `VERTICALS`.
**Fix**: Optional `serviceTypes` prop, populated from the category's own DB
`service_types`.
**Prevention**: Verified in-browser (Plumbing → Drain Cleaning, Water Heater, Sewer Line);
homepage test asserts categories come from the DB, not the constant.

---

## ZIP → city autofill silently dead for every Valley homeowner — 2026-07-25
**Symptom**: Typing a real ZIP autofilled nothing. No error, nothing in the console.
**Root Cause**: `zipCityMap.ts` held only Santa Clarita Valley ZIPs (91350–91390,
91321–91322), left from before the SFV pivot. `cityFromZip` returns `null` on a miss and
the caller only sets the city on a hit — so total failure looked identical to no input.
**Fix**: Replaced with SFV ZIPs for all six covered cities.
**Prevention**: None automated. Region data is worth an assertion if coverage changes again.

---

## Five live 404s in site navigation — 2026-07-25
**Symptom**: Header "Pricing" and four footer links led to the 404 page in production.
**Root Cause**: `/cost-guides`, `/plumbers`, `/services/hvac`, `/services/landscaping`,
`/services/electrical` are referenced in nav but have no route in `App.tsx`.
**Fix**: Nav rebuilt around routes that resolve.
**Prevention**: `HeaderVariant.test.tsx` asserts `/cost-guides` and `/plumbers` never
reappear in header hrefs.

---

## Out-of-area notice could never render — 2026-07-25
**Symptom**: Dead UI branch.
**Root Cause**: `LocationStep` compared city to `"Other / Outside SCV"`; the option list
offers `"Other / Outside SFV"`. Renamed on one side only during the pivot.
**Fix**: Compare against the SFV value; copy updated to San Fernando Valley.

---

## Sitemap and RSS pointed at the retired Supabase project — 2026-07-25
**Symptom**: Search engines and feed readers fetched a dead host. Invisible in the UI.
**Root Cause**: `index.html` still referenced `cjdhbiuhzrpruqbbnnqz` in the sitemap link,
RSS `<link>`, and a `preconnect`.
**Fix**: Repointed to `lrqdbpphallqehpdqalr`.
**Prevention**: See the dead-project-ref entry in `knowledge.md` — grep for it.

---

## Admin cron toggle pointed two jobs at the dead project — 2026-07-25
**Symptom**: Enabling `publish-scheduled-posts` or `send-nurture-emails-hourly` from the
System Status page returned success; the jobs could never actually run.
**Root Cause**: `admin_toggle_cron_job` hardcoded the old project URL and a matching anon
key. `cron.schedule()` succeeds regardless of whether the URL inside the command resolves.
**Fix**: `20260725150000_fix_cron_admin_toggle_project_ref.sql`.
**Prevention**: Verified post-migration that the old ref appears nowhere in the function
body and the current ref appears once per job.

---

## Site copy described a lead-brokerage business — 2026-07-25
**Symptom**: Not a crash — a positioning failure. The FAQ's buyer section read
*"a residential plumbing lead generation service… you pay for exclusive leads,"* and Terms
called the site *"a lead referral service… with local plumbing professionals"* in the
*"Santa Clarita Valley."*
**Root Cause**: Copy predating two pivots (region, then business model) was never revisited.
**Fix**: FAQ rewritten for homeowners and business owners; Terms and Privacy corrected to
describe the directory that exists.
**Prevention**: Worth re-reading public copy whenever the business model changes — a
contractor doing diligence reads these pages before claiming a listing.

---

## Phone numbers rendered as raw E.164 — 2026-07-25
**Symptom**: `+18185550102` instead of `(818) 555-0102` on city cards and in the owner's
own lead log.
**Root Cause**: `formatPhoneDisplay`/`toTelHref` existed as private helpers in
`DirectoryListing` and weren't available elsewhere.
**Fix**: Moved into the shared directory module and reused.
**Prevention**: Unit tests cover both helpers.

---

## Lead capture on unclaimed listings — 2026-07-25
**Symptom**: Quote requests could be captured for a business that had never agreed to
anything — the core "you're stealing our leads" risk.
**Root Cause**: No gate; the form rendered regardless of `is_claimed`.
**Fix**: `submit-directory-lead` returns 403 when `is_claimed` is false (server-side, since
a client check isn't a boundary); the form doesn't render on unclaimed listings.
**Prevention**: Verified in production with a direct API call that bypassed the UI.
