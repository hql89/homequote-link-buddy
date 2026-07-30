# Implementation Plan — Business Ingestion Engine

**Status:** Draft — awaiting approval
**Date:** 2026-07-25
**Blocks:** outreach (directory is currently 0 rows; the cold email says "I added your business")
**Supersedes:** the completed Valley Home Pros pivot plan (archived to `docs/plans/`)

## Confirmed decisions

| Decision | Choice |
|---|---|
| Data source | **CSLB** contractor licenses, optional per-business enrichment later |
| Post-ingest behaviour | **Silent** — unpublished, outreach paused, no email. Released manually. |
| Pace | **~25/day, admin-adjustable** without a deploy |

## Why CSLB rather than Google Maps

Scraping Google Maps violates their ToS. The official Places API is legal but its terms
bar retaining most Place content beyond ~30 days (only `place_id` is indefinitely
storable) — unworkable as the system of record for permanent listing pages.

CSLB is authoritative, free, no registration, CSV/Excel, and legal to store. Every category
we list is a licensed CA trade: D-49 tree service, C-36 plumbing, C-20 HVAC, C-10
electrical, C-27 landscaping. It also carries **license status and expiry**, which makes the
"Licensed & Insured Pros" badge already on the homepage actually true, and gives the cold
email a far better opening than "I found you on Google."

Sources: [CSLB Data Portal](https://www.cslb.ca.gov/onlineservices/dataportal/),
[Master contractor list](https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList)

## Why a staged queue instead of an auto-fetcher

The CSLB portal is JavaScript-driven and its download endpoints could not be verified
programmatically. Auto-fetching it would be brittle and would fail silently the first time
the page changes. The statewide License Master is also far too large to parse inside a Deno
edge function (~150s, constrained memory).

So the heavy step happens **once, outside the runtime**, and the daily engine drains a
staging table:

```
CSLB portal  ──(admin downloads a filtered CSV: classification × LA County/city)
     │
     ▼
[ import ] ──▶ ingest_queue (pending)
                    │
                    ▼  daily cron, N rows/day (admin-configurable)
              [ process-ingest-queue ]
                    │  dedupe → normalise → insert
                    ▼
               businesses (is_published = FALSE, outreach_paused = TRUE)
                    │
                    ▼  admin reviews, releases in batches
               live listing + outreach eligible
```

Side benefit: the engine is **source-agnostic**. Any CSV — a Places export, OSM, a manual
list — feeds the same queue.

## Scope

### 1. Schema (`supabase/migrations/<ts>_ingest_engine.sql`)

**`businesses`** — new columns:
- `license_number TEXT` — CSLB number; the natural dedupe key
- `license_status TEXT`, `license_expires_at DATE`
- `source TEXT NOT NULL DEFAULT 'manual'` — `'cslb' | 'manual' | 'places'`
- Unique partial index on `license_number WHERE license_number IS NOT NULL`

**`ingest_queue`** — new table:
- `id`, `source`, `raw JSONB` (the original row, kept for audit)
- Extracted: `business_name`, `license_number`, `city`, `phone`, `address`, `classification`
- `status TEXT` — `pending | ingested | skipped | failed`
- `skip_reason TEXT`, `business_id UUID` (set on success), `processed_at`, `created_at`
- Unique index on `license_number` so re-importing the same CSV is idempotent
- RLS: service-role writes only; admins may read (matches `businesses`)

**`admin_settings`** — new row `ingest_config`:
```json
{ "daily_limit": 25, "enabled": true, "cities": ["Sherman Oaks","Encino","Studio City","Tarzana","Valley Village","Toluca Lake"] }
```
Reuses the existing settings pattern (`smtp_config`, `outreach_templates`) so the rate is
changed from admin, not a deploy.

**Rollback:** drop `ingest_queue`, drop the four `businesses` columns, delete the settings
row. Additive only; nothing existing is modified.

### 2. Import path
Admin uploads the CSLB CSV in the browser; parsed client-side and inserted into
`ingest_queue` in chunks via a new `import-ingest-queue` edge function (service-role,
admin-gated — same auth posture as `ingest-business`). Rows are filtered to the configured
cities and the five target classifications at import time, so the queue only ever holds
candidates we actually want.

Client-side parse keeps the multi-hundred-thousand-row file out of the edge runtime
entirely.

### 3. Daily worker (`process-ingest-queue` edge function)
- Reads `ingest_config`; exits immediately if `enabled` is false
- Claims up to `daily_limit` pending rows, oldest first
- **Dedupe** against `businesses` on `license_number`, then on `(city_slug, slug)` — marks
  duplicates `skipped` rather than failing
- Normalises: `slugify` the name, `toE164` the phone, map CSLB classification → our
  vertical, drop rows with no usable phone
- Inserts with `is_published = FALSE`, `outreach_paused = TRUE`, **no email**
- Writes a `job_run_logs` row (existing pattern) with counts

Reuses `slugify`, `toE164`, `logRun` from `_shared/directory.ts`. Deliberately does **not**
call `ingest-business`, because that endpoint's job is to create-and-email; silent ingest is
a different contract.

### 4. Admin review UI (`/admin/ingest`)
- Queue table: pending / ingested / skipped / failed with skip reasons
- Ingested-but-unpublished businesses with **Publish** and **Publish + start outreach**
  actions, individually and in batches
- Daily limit and enabled toggle, written back to `ingest_config`
- "Run now" button to invoke the worker manually (so this is usable before pg_cron exists)

### 5. Scheduling
The worker is registered as a known job name in `admin_toggle_cron_job` so it can be
scheduled from System Status. **`pg_cron` is not currently installed** — until it is, the
worker runs via the "Run now" button. Enabling pg_cron is a separate, deliberate decision;
this worker is low-risk to schedule since it sends no email.

## Out of scope (flagged, not built here)

**`ai-company-lookup` fabricates business facts.** Its system prompt instructs the model to
*"provide reasonable estimates"* when it lacks data, and it returns `license_number` and
`years_in_business`. That is an LLM inventing license numbers for real, named businesses.
It's wired into `ProviderDashboard` and currently inert only because `LOVABLE_API_KEY` was
never set. It must never become the enrichment path — and it should be fixed or removed on
its own. Recommend a separate task.

## Test strategy

- Unit: CSLB classification → vertical mapping; row normalisation (name/phone/city);
  dedupe key derivation; config parsing with a malformed/missing settings row
- Idempotency: importing the same CSV twice adds no duplicate queue rows; running the
  worker twice over the same queue creates no duplicate businesses
- Guard: a worker run must never set `is_published = TRUE` or send email — assert on the
  inserted row shape
- Manual: import a small real CSLB slice, run the worker, inspect rows, delete

## Acceptance criteria

- [ ] Importing a CSLB CSV populates `ingest_queue`, filtered to configured cities/classes
- [ ] Re-importing the same file adds zero new queue rows
- [ ] Worker ingests at most `daily_limit` per run and respects `enabled: false`
- [ ] Every ingested business lands `is_published = FALSE`, `outreach_paused = TRUE`, with
      **no email sent** — verified against `job_run_logs` and an empty outreach timestamp
- [ ] Duplicate licence numbers are skipped with a reason, not failed or duplicated
- [ ] Rows with no valid phone are skipped (a listing whose whole value is click-to-call is
      useless without one)
- [ ] Admin can change the daily limit and see it take effect without a deploy
- [ ] Publishing from admin makes the listing live; outreach only starts when explicitly
      chosen
- [ ] Zero lint/type/test failures; build succeeds

## Resolved 2026-07-25

1. **Address → city only.** CSLB's address is a *mailing* address, frequently a
   contractor's home. It is used solely to assign `city`/`city_slug` and is never published.
2. **Active licences only.** Expired-but-renewable rows are filtered out at import.
3. **Email → enrichment, deferred to Phase 2** (below).

---

# Phase 2 — Email enrichment (NOT buildable from CSLB alone)

**Prerequisite that does not currently exist.** The chosen approach is: fetch a business's
own public website and extract a contact email. But the
[CSLB Public Sales record layout](https://www.cslb.ca.gov/Resources/FormsAndApplications/Public_Sales_Record_Layout.pdf)
contains **no website field** — license number, business type, classifications, DBA name,
address, city/state/zip, county, phone, dates, bond, workers-comp, and nothing else. There
is no URL to fetch.

Enrichment therefore needs a **website-discovery** step first.

## Discovery source: Perplexity Sonar (chosen 2026-07-25)

Commercial API, no ToS conflict, and it answers the actual question ("official site for this
contractor in this city") in one call. Base Sonar at low search context ≈ **$5 / 1,000
requests** plus negligible tokens → roughly **$4–6/month at 25/day**, under $20/month at
100/day.

**Storage — corrected 2026-07-29.** This originally said "as a Supabase edge
secret" (`Deno.env`). That was never actually built; what exists instead is
`src/pages/admin/settings/PerplexitySettings.tsx`, which writes a write-only,
masked key to `admin_settings.perplexity_config` — the same pattern already
used for `smtp_config`. Whichever edge function implements the discovery
step below must read it from there (mirroring `loadSmtpConfig` /
`loadOutreachTemplates` in `_shared/`), not from `Deno.env`. The panel was
built, then deliberately hidden from `/admin/settings` since nothing read it
yet — a live credential with no consumer — and has now been re-enabled so
the key can be entered ahead of this phase being built.

### The hard rule: Perplexity finds URLs, it never supplies facts

This is the identical failure mode to `ai-company-lookup` (killed this session): a model
asked for a business's email returns a plausible one whether or not it knows. A wrong email
here means sending cold outreach — *"I built you a listing"* — to an uninvolved third party,
under a real named business. Unacceptable.

Therefore the model's output is a **candidate URL only**. The email is taken from the live
page we fetch ourselves, or not at all.

### Verification chain

1. **Discover** — Sonar: official website for `{dba_name}`, contractor in `{city}`, CA.
   Take candidate URL(s); discard any prose answer.
2. **Fetch** — request the candidate domain directly. Respect `robots.txt`, real
   User-Agent, hard rate limit, business's own domain only.
3. **Verify identity via CSLB phone.** CSLB's phone number is authoritative. If a phone on
   the fetched page matches it, this is confirmed the right business — which defeats the
   "similarly-named contractor one town over" mismatch. **No phone match → no auto-accept**,
   row flagged `needs_review`.
4. **Extract** — emails from page content only. Never from model output.
5. **Store** — `email`, `email_source_url`, `email_confidence`, `enriched_at`. Only
   `confidence = 'verified'` rows become drip-eligible.

### Second hard rule: never let a model write listing copy

`businesses.scraped_context` renders on the **public listing page** under the business's
name. An LLM-written description will invent plausible claims — "family owned since 1985",
"24/7 emergency service", "licensed and bonded". Publishing fabricated claims on behalf of a
real business is worse than a bad email: it's public, attributed to them, and it's a
representation we'd be making about their services.

`scraped_context` may be populated **only** from the business's own site copy or from
templated text over verified CSLB fields (name, city, licence class, licence status). Never
from model prose.

### Expected yield
Many small tree-service and landscaping operators are phone-only or run a Facebook page.
Assume well under half of ingested rows produce a verified email; the phone list remains the
primary asset.

**Expected hit rate is low.** Many small tree-service and landscaping operators are
phone-only or run a Facebook page rather than a site. Assume well under half of ingested
rows yield an email; plan outreach accordingly.

**When built, it must:** respect `robots.txt`, identify itself with a real User-Agent, rate
limit hard, fetch only the business's own domain, and take emails only from pages that
publish them for contact. Emails found this way are stored on the business row and make it
drip-eligible; everything else stays a phone-only directory listing.

**Not started.** Needs a key entered in Admin → Settings → Perplexity (see the
storage correction above — not a Deno secret). Phase 1 below is unaffected
and delivers a full directory plus a call list without it.

**Acceptance criteria (Phase 2)**
- [ ] No email is ever written from model output — only from fetched page content
- [ ] An email without a CSLB phone match is stored as `needs_review`, never auto-drip-eligible
- [ ] `email_source_url` is recorded for every enriched row, so any address can be traced
      back to the page it came from
- [ ] `scraped_context` is never populated from model prose
- [ ] Fetcher respects `robots.txt` and rate limits; only the business's own domain is hit
- [ ] Enrichment failure never blocks or reverts ingestion
