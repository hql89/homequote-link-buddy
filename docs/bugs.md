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

---

## Background Jobs reported unknown state as "Off" — 2026-07-27
**Symptom**: Settings → Background Jobs showed three jobs each with a confident "Off" badge
and an operable switch. Flipping one produced a raw Postgres error.
**Root Cause**: `admin_list_cron_jobs` selects from `cron.job` with no guard for the
extension. With `pg_cron` absent the RPC throws `42P01`, but the panel destructured only
`isLoading` from `useQuery` — never `isError`. On failure `jobs` was `undefined`, so
`!!job?.active` evaluated to `false` for every job and rendered as "Off". The panel was
asserting a state nobody had read.
**Fix**: Added `src/lib/cronAvailability.ts` to classify the failure (`42P01` → extension
missing, `P0001` + "Forbidden" → permissions, else unknown). The panel now renders an
explicit notice per case, badges read "Status unknown", and every switch is disabled.
**Prevention**: `tests/unit/cronAvailability.test.ts` covers the classifier including the
message-only fallback; `tests/unit/BackgroundJobsSettings.test.tsx` asserts no "Off" badge
renders on a `42P01` and that all switches are disabled.

---

## Enabling a job reported it "running" when it could only 404 — 2026-07-27
**Symptom**: Toast read "<job> is now running on schedule" after enabling any background job.
**Root Cause**: `admin_toggle_cron_job` writes a `cron.job` row and nothing more. Two of the
four managed jobs post to `publish-scheduled` and `send-nurture-emails`, neither of which is
deployed — so "running on schedule" meant an HTTP POST to a 404 every 15 minutes.
**Fix**: Toast now says "is now scheduled" — true for all four jobs and claims nothing about
liveness that wasn't checked.
**Prevention**: Deployment state can't be seen from the browser, so this is a copy
discipline rule rather than a testable one: describe what the call did, not what you hope
it started.

---

## Perplexity panel stored a credential nothing read — 2026-07-27
**Symptom**: None visible — the panel looked and behaved correctly.
**Root Cause**: Phase 2 enrichment was never built. `admin_settings.perplexity_config` had
exactly two references: the panel writing it and the page rendering the panel.
**Fix**: Removed the render from `Settings.tsx`. The component and its test are kept intact
so Phase 2 restores one import and one JSX line.
**Prevention**: Trace every `setting_key` to a reader before shipping a panel. **Note the
stored key itself survives this fix** and needs deleting in the Supabase dashboard.

---

## System Status claimed a publish schedule that never existed — 2026-07-27
**Symptom**: Scheduled Tasks card read "The publish-scheduled function runs every 5 minutes."
**Root Cause**: Wrong three ways — `publish-scheduled` isn't deployed, `pg_cron` isn't
installed so nothing is scheduled, and the RPC's schedule for that job is `*/15`, not 5
minutes. The copy was a hardcoded assumption in the card's empty state.
**Fix**: Empty state now says no scheduled tasks are reported and admits it can't tell
"nothing scheduled" from "couldn't read", pointing at Settings → Background Jobs.
**Prevention**: Empty-state copy must not assert facts about systems the component never
queried. The underlying cause — `system-status` calling the nonexistent `get_cron_jobs` RPC
— is fixed in code (see next entry) and **confirmed deployed**: the live function (checked
2026-08-17 via direct source inspection, not just a version-number bump) calls
`admin_list_cron_jobs` through `userClient`, matching the fix below.

---

## `system-status` edge function called a nonexistent RPC and pinged a stale function list — 2026-07-27
**Symptom**: The Scheduled Tasks card on System Status has never once shown a job, even when
`admin_list_cron_jobs` would have real rows to return. Separately, the Backend Functions card
checked only 10 of 26 real functions and included several that were never deployed.
**Root Cause**: `adminClient.rpc("get_cron_jobs")` calls an RPC that exists in no migration —
caught and silently replaced with `[]`. `knownFunctions` was a hand-written list frozen at an
earlier point in the project and never updated as functions were added.
**Fix**: Repointed to `admin_list_cron_jobs`, called via `userClient` rather than
`adminClient` — that function's `is_admin()` gate reads `auth.uid()`, which only resolves for
a client carrying the caller's own JWT. `knownFunctions` expanded to all 26 entries in
`supabase/functions/` (minus `_shared`).
**Prevention**: `deno check` passes on the edited file. **Not deployed** — per this project's
"Deployment → `/deploy` only, never push ad-hoc" rule, the fix is committed to the repo but
inert in production until deployed deliberately.

---

## `migrate-helper` hardcoded the gate key to the DB URL and service role key — 2026-08-01
**Symptom**: None observed — found by inspection, not by any failure.
**Root Cause**: `supabase/functions/migrate-helper/index.ts` returned
`SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` (bypasses all RLS) to any caller supplying
the right `x-access-key` header. That header's expected value,
`ACCESS_KEY = "6^kkRHET6ZBW^E6-cB"`, was hardcoded in plaintext in the committed file — not
the DB URL or service-role key themselves, which were only read from env at request time, but
the door key to them if the function were ever live and someone had it.
**Fix**: File deleted outright in `2bc0c66` (also dropped from `config.toml` and
`system-status`'s health-check list) rather than gated better — nothing used it.
**Severity, verified in a follow-up session rather than assumed**:
- Repo is **private** (`gh repo view` confirms), not public — exposure was limited to whoever
  has repo access, not the open internet.
- File existed 2026-07-19 → 2026-08-01 (~13 days). The `BUILD_ID = "2026-03-04"` string inside
  it is stale boilerplate text, not the real creation date — don't read the file's own claims
  about itself at face value.
- Two independent signals say the function was **never deployed**: the removal commit says so,
  and a separate `supabase functions list` check earlier the same week independently showed
  `migrate-helper` absent from the deployed set. Not provable back further than that from here
  — no access to Supabase's deploy history — but two independent misses on a private repo over
  13 days is a low-probability gap.
- The access-key string doesn't reappear anywhere else in git history — not a reused pattern.
**Prevention**: **Resolved 2026-08-08 — not by rotation.** Turned out Supabase had already
removed the ability to rotate legacy `anon`/`service_role` keys by this point; rotation
wasn't an available option, only a migration off them entirely. That migration (see
`docs/plans/implementation_plan_api_key_migration_2026-08-01.md`) was completed instead: all
28 edge functions and the frontend moved to the new publishable/secret key system, then the
legacy key pair was disabled outright in the Supabase dashboard — a stronger close than
rotation, since the possibly-exposed key isn't just changed, it's fully inert. Confirmed via
two independent signals, not assumed: a direct request with the old key now returns `401`,
and Supabase's own key-management API reports the legacy anon key as `disabled: true`.
Verified **zero legacy-key requests** in a full 24-hour window of production logs (checked
2026-08-17 via the project's Supabase MCP connection) before treating this as closed.

---

## Every Vercel deployment silently blocked since 2026-08-02 — 2026-08-08
**Symptom**: The live site (`homequotelink.com`) kept serving a build from Aug 1 no matter how
many commits landed on `main` afterward — including a security-relevant one (the frontend API
key migration). No error surfaced anywhere in the repo, tests, or build; the only place it was
visible at all was Vercel's own Deployments list, which nobody was watching.

**Root cause — took three wrong theories to find**:
1. First guess: commit author (`AntiGravity AI <admin@homequotelink.com>`) wasn't a real GitHub
   identity Vercel could match → wrong. Verified `admin@homequotelink.com` is a *verified* email
   on the `dgarcia891` GitHub account, and `gh auth status` confirmed the actual push was
   authenticated as `dgarcia891` directly.
2. Second guess: Vercel wanted the GitHub account's *primary* email specifically, not just any
   verified one → tested by pushing a commit authored as `dgarcia89@gmail.com` (the primary).
   Still blocked. Disproved.
3. Actual cause, found by comparing the exact commit where deploys flipped from Ready to
   Blocked (`103def0`, Aug 1, Ready → `7c307b5`, Aug 2, Blocked) and finding the **same commit
   author on both sides** — proving author identity was never the variable. What changed instead:
   the Vercel *project* was transferred to a new account (`admin@homequotelink.com`, created to
   dodge the Hobby-plan project-count limit) that had **no GitHub account linked** under Account
   Settings → Authentication. With nothing to match any pusher's identity against, the account
   blocked every commit from everyone — a private-repo Hobby-plan restriction, not a code issue.

**Fix**: User reconnected GitHub under that Vercel account's Authentication settings. Verified
immediately after with a disposable empty test commit — Vercel showed `Ready` within 30s.

**Full verification chain used, not just Vercel's own "Ready" status**:
- `curl` the live bundle URL directly and diff its hash against the local build's hash
- Grep the deployed bundle for the new key string, confirming it's actually in the shipped JS,
  not just committed to the repo
- Browser console clean, real data rendering (business listings, correct phone numbers, correct
  per-city counts) — data that could only appear with a working, authenticated Supabase key

**Prevention**: When "I pushed and nothing changed" — check the deploy platform's own dashboard
*before* re-diagnosing the code. Two disposable empty test commits (`git commit --allow-empty`)
were the fastest way to get a real, isolated signal on each theory, cheaper than re-reading
account settings speculatively. If Vercel ever shows a fresh wave of `Blocked` deployments
again, check Account Settings → Authentication → GitHub connection first, before assuming
anything code-side changed — this project's Vercel account has already silently dropped that
connection once.
