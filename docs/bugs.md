# Resolved Bugs

Newest first. Root causes, not just symptoms.

---

## Lead-notification email kept re-pinging proven-dead business addresses — 2026-08-24
**Symptom**: User asked (looking at a bounce row in `/admin/replies`) whether there was a
way to designate an email as invalid so the system stops re-emailing it — implying a
suspicion the mechanism either didn't exist or wasn't working.
**Root Cause**: There *was* an automatic, working suppression mechanism —
`receive-inbound-email`'s `handleBounce()` stamps `businesses.email_undeliverable_at` the
moment a real recipient-side bounce arrives, and `send-outreach-drip` already filters on
it. But `submit-directory-lead` (the edge function that emails a business every time a
homeowner submits the "Request a Free Quote" form) never checked that flag — it sent to
`business.email` unconditionally. A business proven dead by cold-outreach bounce detection
would still get pinged on every subsequent lead. Confirmed live: Thynk Remodeling's
`email_undeliverable_at` was already set from a real bounce, but nothing in the lead path
read it.
**Fix**: Added `emailSkipReason()` (`supabase/functions/_shared/directory.ts`) — a small
pure function shared conceptually with `send-outreach-drip`'s existing filter. Wired into
`submit-directory-lead` to skip the send (lead is still saved) and record why in a new
`directory_leads.notify_skipped_reason` column, kept separate from `notify_error` so "we
knew not to try" is never indistinguishable from "we tried and it broke."
**Prevention**: `tests/unit/emailSkipReason.test.ts` covers both flags and the safe-to-send
case. Also made the mechanism *visible* rather than trust-me: `/admin/replies` now shows an
"Auto-suppressed since <date>" badge on a bounce row the instant the flag is set (no click
needed), and `/admin` (Overview) has a running KPI counting skipped notifications per date
range — so the fact that suppression is working stays checkable at a glance instead of
resting on memory of a single row. General lesson: when a table has more than one
notification/send path to the same recipient, a suppression flag added for one path does
not automatically protect the others — grep every place that reads `business.email` before
trusting a "we stopped emailing them" claim.

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

**Recurred 2026-08-17.** Same symptom (`Deployment Blocked`, "commit author did not have
contributing access"), same fix (reconnect GitHub under Account Settings → Authentication),
confirmed working again within 30s via the same empty-commit diagnostic. *Why* it disconnected
a second time is still unknown — this entry only confirms the fix keeps working, not that the
underlying cause is understood. Two things worth knowing if it happens a third time:

- **Vercel's own blocked-deployment screen offers "Upgrade to Pro" as if that were the fix.
  It is not** — the actual cause both times was the missing GitHub connection, not a plan
  limit. Upgrading would cost money and fix nothing.
- **The GitHub connection lives under *personal* Account Settings, not the project/team
  Settings gear in the left sidebar.** Those are two different settings areas that happen to
  look similar; the team one has no Authentication section at all, which cost real time
  navigating it before finding the right page
  (`vercel.com/account/authentication` gets there directly).

---

## Admin cron toggle carried a legacy key that went dead mid-flight — 2026-08-08
**Symptom**: None observed at the time — found by inspection immediately after disabling the
legacy Supabase key pair, before anyone hit it in the UI.
**Root Cause**: `admin_toggle_cron_job` hardcoded the legacy anon JWT as the Bearer token for
four of its five managed jobs. The moment the legacy key pair was disabled (closing out the
`migrate-helper` exposure above), that hardcoded token went from merely deprecated to actively
dead. Nothing broke immediately — the only job actually *scheduled* at the time
(`prune-internal-job-logs-daily`) calls SQL directly and carries no key — but the next admin
to flip a switch in Settings → Background Jobs would have scheduled a job that reports "on"
and does nothing, forever, silently. Second occurrence of this exact failure shape in this
project (see "Enabling a job reported it running..." above) — same symptom, different dead
credential.
**Fix**: `20260808170000_cron_toggle_drop_dead_legacy_key.sql`. Checked each job rather than
patching in a replacement key uniformly: three of the four (`send-nurture-emails`,
`send-outreach-drip`, `email-canary`) are `verify_jwt = false` in `config.toml`, so the header
was doing nothing even while the key was alive — removed entirely rather than replaced. Only
`publish-scheduled` actually needs a credential (no `config.toml` entry, defaults to
`verify_jwt = true`); it gets the new publishable key.
**Prevention**: Verified post-migration that the dead key string appears nowhere in the
function body. General lesson: disabling or rotating a credential doesn't only affect the
places that read it from an env var at request time — grep for the literal key value across
the whole schema (functions, RPCs, triggers), not just application code, before considering a
key fully retired.

---

## Sitemap queries intermittently failed with a JWT-decode error — 2026-08-17
**Symptom**: None reported — found while checking Supabase's request logs for an unrelated
legacy-key verification. `sitemap.xml` never looked broken (always `200`, always valid XML)
because the function already falls back to `?? []` on missing query data.
**Root Cause**: `sitemap`'s three concurrent queries (`public_business_listings`, `posts`,
`buyers`) intermittently returned PostgREST error `PGRST303` ("JWT claims decoding failed")
— roughly 1 in 4 requests, with a sibling query in the *same* request succeeding using the
identical client and key, milliseconds apart. Ruled out this project's code as the cause
before accepting it as unfixable here: one `createClient` call, one synchronous key from
`serviceRoleKey()`, no per-request auth computation that could race across the concurrent
`Promise.all` calls. The failure is upstream, in Supabase's own gateway — plausibly related
to the platform-wide legacy-key retirement this project's own key migration was part of,
though that link is inference, not something Supabase confirmed.
**Fix**: `withRetry()` wraps all three queries (up to 2 retries, 300ms apart). Existing
`?? []` fallbacks are unchanged and remain the last resort if every retry is exhausted.
**Prevention**: A graceful fallback prevents a crash but also fully hides the failure —
this bug produced zero visible symptoms for as long as it existed, and was only found by
reading log data, not by anything the UI ever showed. "Never throws" and "never fails" are
not the same claim; worth periodically checking Supabase's logs for silent `4xx`/`5xx`
responses on any function that degrades gracefully by design.

---

## Site analytics silently stopped recording for six months — 2026-08-27
**Symptom**: `analytics_events` held 127 rows, newest 2026-03-22. The admin analytics
dashboard rendered a normal-looking report built on a table frozen in March. Nobody could
answer whether outreach emails brought anyone to the site.
**Root Cause**: Commit `922bf81` ("integrate GA4 tracking") rewrote `trackEvent()` to send to
Google Analytics via `gtag` and *removed* the Supabase write rather than adding alongside it.
Page-view tracking itself was never broken — `PageTracker` → `usePageTracking` had been firing
correctly the whole time; the events had nowhere to land.
**Fix**: Restored the `track-event` invoke as a second sink beside `gtag`, under
`Promise.allSettled` so neither can cost the other. Credential-shaped query params are
redacted from `page_path`, `page_url` and `referrer` before sending — the outreach claim link
carries `?token=<claim_token>`, which authorizes claiming a listing and had been about to be
written into an analytics table in plain text.
**Prevention**: `tests/unit/analyticsService.test.ts` covers the dual write, token redaction
(verified in a real browser with a canary token), and failure isolation. Also found and fixed
in the same pass: local dev shares the production Supabase project, so `npm run dev` began
filing real page views against the live table — loopback, `*.localhost` and `*.local` now skip
alongside the Lovable preview hosts.

---

## An expired API key read as a quiet day for 30 days — 2026-09-26
**Symptom**: Outreach sent nothing for 28 days. The Enrichment page showed no error. Every
enrichment run logged `status: 'success'`.
**Root Cause**: Two independent failures stacked. (1) The Perplexity key expired; every row
failed with HTTP 401, but `enrich-business-email` only logged a failure when the whole
invocation threw, so 20-of-20 rows failing was a "success" with `verified: 0`. (2) The
Enrichment page built its summary from run metadata only, and `summariseEnrichment` returns no
text when `considered` is absent — which it always is for a run that never started — so the
page rendered `{lastRun && ...}` as nothing at all. A page failing every morning looked
identical to one that had never run, while `admin_recent_job_runs` was already returning the
`status` and `error_message` it discarded.
**Fix**: Run status is now derived in a pure tested function: all rows throwing is a failure,
some is partial, and the deduplicated error text is written to `error_message`. The page
renders an explicit failure notice with the catalogued explanation. A daily sweep raises an
alarm after 3 consecutive failures, and alarms now email the admin.
**Prevention**: `summariseEnrichmentRun` tests pin the 20-of-20 case directly.
`Enrichment.test.tsx` covers the failure render, including a failure with no recorded reason.
The sweep requires the streak to be live within 7 days, after its first run flagged
`unsubscribe` — 3 failures whose newest was 28 days old, and bot traffic rather than a broken
job.

---

## Every ten digits on a page was treated as a phone number — 2026-09-26
**Symptom**: Four businesses sat in the review queue because "the phone on their website did
not match their licence". Three of the site phones were `(529) 411-7647`, `(942) 938-4556` and
`(532) 272-9582`.
**Root Cause**: `extractPhonesFromHtml` matched `\d{3}\d{3}\d{4}` with optional separators, no
NANP validation and no word boundaries — so licence numbers, tracking codes and substrings of
longer digit runs all became "phones". The harm was never a false match (junk cannot equal the
CSLB number) but a misleading one: `email_source_phone` showed a reviewer an invented number
beside the real licence number, making honest businesses look like the wrong ones.
**Fix**: Word boundaries, plus `isPlausibleUsPhone` — exchange rules and an assigned
area-code list. Structural NANP rules alone were not enough and this is worth remembering:
942 and 532 satisfy them and are rejected only for not existing.
**Prevention**: The three real junk numbers are regression cases. The area-code list fails
safe — an unlisted code sends a business to review and can never cause a wrong verification.

---

## One bounce marked six delivered emails as failures — 2026-09-27
**Symptom**: Found while forcing the first real alarm email. A single blocked message to
`dgarcia89@gmail.com` set `status: 'bounced'` on six rows at the same instant — itself, four
delivery probes from 23–26 Sept, and the test email the admin had personally confirmed
receiving four hours earlier.
**Root Cause**: `receive-inbound-email` recorded a bounce with
`.ilike("recipient_email", recipient).eq("status", "sent")` — every outstanding send to that
address, not the message that bounced.
**Fix**: Resolve the single most recent outstanding send for that recipient and update only
that row. A repair migration restored rows sharing a `bounced_at` with a *later* send to the
same address — a real bounce is always the newest outstanding message when it arrives, so an
older row stamped at the same instant can only be collateral.
**Prevention**: This is not cosmetic. The bounce-rate circuit breaker counts exactly these
rows, so one bounce to a business could have manufactured an entire failing streak and halted
the campaign on evidence that never happened. When a handler writes a status derived from an
external event, scope it to the one record that event concerns.

---

## The bounce circuit breaker was set to fire at 50% — 2026-09-26
**Symptom**: None visible. It had never fired.
**Root Cause**: `BOUNCE_CIRCUIT_THRESHOLD = 0.5` — sending only halted once half of recent mail
bounced. Mailbox providers penalise a domain long before that, so it was protection in name
only. It also discarded both query errors, so an unreadable count became `0 sends` and skipped
the gate entirely.
**Fix**: Threshold 0.15 over a 20-send minimum (the two must move together — at 15%, a sample
of 10 halts on 2 bounces, close enough to noise to stop the campaign for nothing). Overridable
from `outreach_config`, range-checked rather than merely type-checked, since `rate >= NaN` is
always false and one malformed value would leave the breaker looking configured while never
firing. Fails closed on an unreadable count. Tripping now also raises an alarm.
**Prevention**: `emailSafety.test.ts` includes a regression asserting the old 50% threshold
would not have fired where the new one does.

---

## A space in a contractor's own contact link became part of their email address — 2026-09-28
**Symptom**: The first batch under the new outreach copy went out on 2026-09-27. One of the two
bounced within three minutes. The address was `%20info@lushgardensinc.com`.
**Root Cause**: `extractEmailsFromHtml` allowed `%` in the local-part class — legal in an email
address by the RFC, but wrong for a `mailto:` URI, which is percent-*encoded* by definition.
`mailto:%20info@…` means `mailto: info@…` with a leading space the page author left in, and the
pattern took `%20info` as the local part verbatim. It was stored, marked `verified`, and mailed.
**Fix**: The mailto target is decoded, trimmed and strictly re-validated before being accepted.
Plain page text is NOT decoded — a literal `%20info@…` written there is not an address, and
decoding it would be inventing one — and that branch gained a lookbehind so a suffix of a
longer token can never be read as a whole address. `%` is now absent from the validator
entirely: one surviving a decode is encoding that did not decode cleanly, and an unenriched
business costs less than an email to an address that does not exist. A malformed escape
discards the candidate rather than throwing out of the run.
**Prevention**: The real address is a regression case. Checked rather than assumed: it was the
only malformed address among 28 — but the scanner would have kept producing them across the 436
still queued. The affected row was repaired by decoding, and its bounce flags cleared, because
`email_undeliverable_at` also gates quote-request notifications and would have silently
stopped a real business's leads over our own formatting bug.
**What worked**: Capping the first run at 2/day instead of 5 is why this surfaced on day one
rather than week six. Worth repeating for any future copy or extraction change.

---

## Outbound mail is being spam-blocked by the host's own relay — 2026-09-28 (OPEN)
**Symptom**: The user asked whether spam complaints had been received. There were none — but a
cross-check of delivery records against the actual inbox showed one of that morning's two
outreach emails had never arrived, while being recorded as `sent`.
**Root Cause**: MailChannels, the relay in this domain's SPF record, rejected the message with
`550 5.7.1 [CS] Message blocked` — a content judgement, not a recipient problem. The same
filter blocked an alert email on 2026-09-27 (fixed there by shortening a subject line that
carried 120 characters of machine output). It is now hitting real outreach, and the rejection
lands after SMTP has accepted, so nothing in the send path notices.
**Fix**: NOT FIXED — mitigated. Outreach sending was paused on 2026-09-28 by unscheduling
`send-outreach-drip-daily` through Admin → Settings → Background Jobs. Enrichment, the delivery
canary and the alarm sweep continue, as none of them email a contractor. The real fix is
ENH-006: move sending to Resend as the primary route.
**Prevention**: Two reasons this was stopped rather than ridden out — "sent" currently does not
mean delivered, so every further send is unverifiable; and repeatedly pushing mail a host's own
filter rejects is the behaviour most likely to get a shared hosting account acted on, which is
the specific risk the owner had asked about the day before.
**Also found**: bounce attribution is still wrong in a second way. Because every outreach email
BCCs the admin address, a blocked outreach message names that address in its failure notice,
and the handler pinned the failure on the most recent send to *that* address — the 14:00
delivery probe, which had actually arrived. Deliberately not queued as its own fix: ENH-006/007
delete the bounce-parsing mechanism entirely.

---

## Every directory page told Google to index the homepage instead — 2026-09-29
**Symptom**: 536 contractor pages, a complete and correct sitemap, crawling allowed,
~34 visitors since analytics was restored and **zero** homeowner quote requests ever. It
read as a demand problem, and was discussed as one three times.
**Root Cause**: `vercel.json` rewrites every path to the static `index.html`, whose head
carried `<link rel="canonical" href="https://homequotelink.com/">`. That file is served
for every route, so all 553 sitemap URLs declared themselves duplicates of the homepage —
an explicit instruction not to index them. `PageMeta` set the right values, but in a
`useEffect`, so they existed only after JS ran and nothing prerendered. Verified by
hashing the responses for `/`, `/directory`, `/directory/encino` and a listing: byte-identical.
Secondary: `SITE_URL`, the sitemap and the canonical all named the apex while the site
308s to `www`, so every listed URL redirected.
**Fix**: Vercel edge middleware injects per-route head tags into the built shell
(`middleware.ts`, with the logic in `src/lib/routeMeta.ts`, `crawlerMeta.ts` and
`headInjection.ts`). Static canonical removed from `index.html` — no canonical is correct,
a wrong one is not. Host settled on `www` in `SITE_URL` and the sitemap's `DEFAULT_DOMAIN`.
**Prevention**: `routeMeta.test.ts` asserts only the homepage canonicalises to `/` and that
`index.html` contains no canonical at all; `headInjection.test.ts` pins the no-meta path as
byte-identical passthrough; `sitemapHost.test.ts` fails if the two host literals diverge.
Both guards mutation-tested. Note the class of failure: everything externally checkable
(robots.txt, sitemap, HTTP status) passed. Only `curl` plus reading the head found it.

## A homeowner's confirmation email was recorded as sent before it was attempted — 2026-09-29
**Symptom**: None visible, which is the problem. `lead_nurture_emails` said `sent`,
`lead_events` said "Confirmation sent", the handler returned `success: true`.
**Root Cause**: `send-lead-confirmation` inserted the row with `status: 'sent'` and a
`sent_at`, then fired `await fetch(...)` and discarded the response. Any
notify-admin-email failure — SMTP down, circuit breaker tripped, MailChannels content
block — left the homeowner with no email and nothing anywhere recording it.
**Fix**: send first, capture `res.ok`, catch a thrown fetch, record the real outcome, and
return a `success` reflecting the send. On failure the row is left at the column default
`scheduled`, so `send-nurture-emails` retries it — verified that column is
`NOT NULL DEFAULT 'scheduled'` against the live schema, without which the "self-healing"
claim would have been false.
**Prevention**: applies the pattern `send-nurture-emails` already used correctly
(`index.ts:156` gates on `res.ok`). No test: nothing in this suite exercises an
edge-function handler, and building that harness did not belong in a recovered fix —
recorded as known-untested rather than papered over.

## Outreach fallback mailed as an unauthorised sender and counted it as contact — 2026-09-29
**Symptom**: Businesses marked `outreach_email_1_sent_at` and never retried, for mail that
was quarantined before delivery.
**Root Cause**: `mailer.ts` computed its Resend sender as
`RESEND_SENDER_EMAIL || fallbackFrom`, falling back to the SMTP identity. With
`RESEND_SENDER_EMAIL` unset, fallback sends went out as homequotelink.com through Resend —
not in the domain's SPF, no Resend DKIM key, DMARC `p=quarantine`. Resend still returned
2xx, so the mailer recorded `success: true, method: "resend"`.
**Fix**: `resolveResendSender` refuses rather than guessing — no configured sender means no
fallback send, `method: "none"`, and an error naming both legs. It never falls back to the
SMTP identity.
**Prevention**: `emailSafety.test.ts` includes a case asserting a present, plausible
`smtpFallbackFrom` never becomes the sender.

## A web developer's address was stored as a contractor's contact and cold-mailed — 2026-09-29
**Symptom**: `micah@micahrich.com` stored as the contact for Capitol Plumbing & Rooter Inc,
sent outreach 2026-08-21 and 2026-08-25.
**Root Cause**: `enrich-business-email` took `emails[0]` — document order, which is mailto:
links before the plain-text sweep. That picks whoever appears earliest, and a "site by"
footer credit appears early. `PLACEHOLDER_EMAIL_DOMAINS` cannot catch it: the developer's
domain is a real, deliverable mailbox, just not the business's.
**Fix**: `selectBusinessEmail` prefers an address on the page's own registrable domain, and
an off-domain one cannot reach `verified` — a gate in front of `resolveConfidence`, not a
signal inside it, because the page reasoning answers "is this the right site" and this
answers "is this address even the site's".
**Prevention**: The first cut gated on "not the site's own domain" and was measured against
production before shipping further: it would have downgraded **7 of 28 verified rows to
catch 1**, the other six being the business's own Gmail or Yahoo. Corrected to three states
(`own`/`shared`/`foreign`) with only `foreign` refused. The four real Gmail rows are pinned
by name in `emailEnrichment.test.ts` so a future tightening must confront them. Lesson in
`docs/knowledge.md` — a filter that false-positives six to one trains the operator to
ignore the queue it fills.

